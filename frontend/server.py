"""Serve the independent frontend and proxy its same-origin API to Python."""

from pathlib import Path
from io import BytesIO
import argparse
import ipaddress
import json
import os
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler, ProxyHandler
from uuid import UUID

from flask import Flask, Request as FlaskRequest, Response, jsonify, request, send_from_directory
from waitress import serve
from werkzeug.exceptions import HTTPException, NotFound, Unauthorized, ServiceUnavailable
from resume_conversion import MAX_UPLOAD_BYTES, extract_resume
from guest_analysis_service import create_guest_blueprint
from guest_analysis_engine import engine_available

ROOT = Path(__file__).resolve().parent

PUBLIC_ERRORS = {
    "invalid_request": "입력한 내용을 확인한 뒤 다시 시도해 주세요.",
    "unauthorized": "로그인이 필요하거나 로그인 시간이 만료되었습니다. 다시 로그인해 주세요.",
    "forbidden": "이 요청을 처리할 권한이 없습니다. 로그인한 계정을 확인해 주세요.",
    "not_found": "요청한 정보를 찾을 수 없습니다. 목록을 새로고침한 뒤 다시 선택해 주세요.",
    "request_timeout": "처리가 지연되고 있습니다. 잠시 후 상태를 확인하고 다시 시도해 주세요.",
    "conflict": "현재 상태에서는 요청을 완료할 수 없습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.",
    "expired": "이용 시간이 만료되었습니다. 필요한 내용을 다시 준비해 주세요.",
    "file_too_large": "10MB 이하 파일을 선택해 주세요.",
    "unsupported_file": "지원하는 파일 형식을 확인한 뒤 다시 선택해 주세요.",
    "rate_limited": "요청이 많아 잠시 기다려야 합니다. 잠시 후 다시 시도해 주세요.",
    "feature_unavailable": "현재 이 기능을 이용할 수 없습니다. 다른 기능을 이용해 주세요.",
    "service_unavailable": "서비스를 잠시 이용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    "request_failed": "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    "auth_failed": "인증을 완료하지 못했습니다. 입력한 정보를 확인하거나 잠시 후 다시 시도해 주세요.",
    "guest_missing": "임시 이력서가 만료되었거나 없습니다. 이력서를 다시 첨부해 주세요.",
    "guest_expired": "임시 이력서가 만료되었거나 없습니다. 이력서를 다시 첨부해 주세요.",
}


def public_api_error(status, path="", upstream_body=b""):
    """Retain HTTP behavior while discarding all upstream diagnostic text."""
    codes = {
        400: "invalid_request", 401: "unauthorized", 403: "forbidden", 404: "not_found",
        408: "request_timeout", 409: "conflict", 410: "expired", 413: "file_too_large",
        415: "unsupported_file", 422: "invalid_request", 429: "rate_limited",
        501: "feature_unavailable", 504: "request_timeout",
    }
    code = codes.get(status, "service_unavailable" if status >= 500 else "request_failed")
    # Only compatibility codes used by the browser may pass through; they select
    # our own text and never carry the service's error message or validation data.
    try:
        data = json.loads(upstream_body)
        candidate = data.get("error", {}).get("code")
        if candidate in {"guest_missing", "guest_expired"} and status in {409, 410}:
            code = candidate
    except (ValueError, TypeError, AttributeError):
        pass
    if (
        re.fullmatch(r"/api/v1/auth/(login|signup|register|forgot-password|reset-password)", path)
        and 400 <= status < 500
        and status != 429
    ):
        code = "auth_failed"
    return {"error": {"code": code, "message": PUBLIC_ERRORS[code]}}


def public_evaluation_progress(data):
    """The progress contract needs identifiers/state, never diagnostic messages."""
    if not isinstance(data, dict):
        raise ValueError("Invalid evaluation progress response")
    if "run" in data:
        events = data.get("events", [])
        if not isinstance(events, list):
            raise ValueError("Invalid evaluation events response")
        return {
            "run": public_evaluation_progress(data["run"]),
            "events": [public_evaluation_progress(event) for event in events],
        }
    result = {
        key: data[key] for key in (
            "id", "run_id", "status", "current_stage", "stage", "progress_percent",
            "started_at", "completed_at", "created_at",
        ) if key in data
    }
    if "failure_reason" in data:
        result["failure_reason"] = (
            "모의지원을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요."
            if data["failure_reason"] else None
        )
    return result


def public_evaluation_events(body):
    """Sanitize each buffered SSE frame; unknown or malformed frames fail closed."""
    frames = []
    for frame in re.split(r"\r?\n\r?\n", body.decode("utf-8")):
        if not frame.strip():
            continue
        fields = {}
        for line in frame.splitlines():
            key, separator, value = line.partition(":")
            if separator and key in {"event", "id", "data"}:
                fields.setdefault(key, []).append(value.lstrip(" "))
        if not fields:
            frames.append(": heartbeat\n\n")
            continue
        event = fields.get("event", ["message"])[0]
        try:
            if event not in {"progress", "done"}:
                raise ValueError("Unknown evaluation event")
            data = public_evaluation_progress(json.loads("\n".join(fields.get("data", []))))
        except (ValueError, TypeError):
            frames.append("event: error\ndata: " + json.dumps(public_api_error(502), ensure_ascii=False) + "\n\n")
            continue
        identifier = fields.get("id", [""])[0]
        prefix = f"id: {identifier}\n" if identifier.isascii() and identifier.isdigit() else ""
        frames.append(prefix + f"event: {event}\ndata: " + json.dumps(data, ensure_ascii=False) + "\n\n")
    return "".join(frames).encode("utf-8")


# These are application-owned validation literals from resume_conversion, not
# parser/library exceptions. Unknown ValueError text gets a generic recovery.
RESUME_VALIDATION_MESSAGES = frozenset({
    "파일이 비어 있습니다. 이력서 내용이 있는 파일을 올려 주세요.",
    "파일은 10MB 이하만 업로드할 수 있습니다. 용량을 줄이거나 본문 붙여넣기를 이용해 주세요.",
    "추출한 본문이 50,000자를 넘습니다. 필요한 경력만 남긴 파일을 올리거나 본문 붙여넣기를 이용해 주세요.",
    "파일에서 본문을 찾지 못했습니다. 내용이 있는 파일을 올리거나 본문 붙여넣기를 이용해 주세요.",
    "TXT 확장자와 실제 파일 형식이 다릅니다. 원래 형식의 PDF·DOCX 또는 일반 텍스트 파일을 올려 주세요.",
    "텍스트 인코딩을 읽을 수 없습니다. UTF-8 또는 CP949로 저장하거나 본문 붙여넣기를 이용해 주세요.",
    "일반 텍스트가 아닌 바이너리 내용이 발견되었습니다. UTF-8 TXT로 저장하거나 본문 붙여넣기를 이용해 주세요.",
    "PDF 확장자와 실제 파일 형식이 다릅니다. 정상적인 PDF를 다시 올려 주세요.",
    "PDF를 읽을 수 없습니다. 파일을 다시 PDF로 저장하거나 본문 붙여넣기를 이용해 주세요.",
    "암호화된 PDF는 읽을 수 없습니다. 암호를 해제한 사본을 올리거나 본문 붙여넣기를 이용해 주세요.",
    "PDF 페이지를 읽을 수 없습니다. 파일을 다시 저장하거나 본문 붙여넣기를 이용해 주세요.",
    "PDF는 50페이지 이하만 지원합니다. 이력서에 필요한 페이지만 남겨 주세요.",
    "PDF 본문을 추출할 수 없습니다. 파일을 다시 저장하거나 본문 붙여넣기를 이용해 주세요.",
    "추출한 PDF 본문이 50,000자를 넘습니다. 필요한 페이지만 남겨 주세요.",
    "PDF에서 텍스트를 찾지 못했습니다. 스캔·이미지 PDF라면 별도 OCR로 텍스트를 추출한 후 본문 붙여넣기를 이용해 주세요.",
    "DOCX 확장자와 실제 파일 형식이 다릅니다. Word에서 DOCX로 저장한 파일을 올려 주세요.",
    "DOCX 압축 해제 용량이 너무 큽니다(최대 30MB). 이미지와 첨부 자료를 줄이거나 본문 붙여넣기를 이용해 주세요.",
    "암호화된 DOCX는 지원하지 않습니다. 암호를 해제한 사본을 올려 주세요.",
    "DOCX 내부 파일 구성이 올바르지 않습니다. Word에서 다시 저장해 주세요.",
    "올바른 DOCX 문서가 아닙니다. Word에서 DOCX로 다시 저장해 주세요.",
    "DOCX 내부 문서 정보가 올바르지 않습니다. Word에서 다시 저장해 주세요.",
    "일반 DOCX 문서만 지원합니다. Word에서 DOCX 형식으로 다시 저장해 주세요.",
    "DOCX 파일이 손상되었거나 형식이 올바르지 않습니다. 다시 저장하거나 본문 붙여넣기를 이용해 주세요.",
    "DOCX 본문을 읽을 수 없습니다. Word에서 다시 저장하거나 본문 붙여넣기를 이용해 주세요.",
})


class InMemoryUploadRequest(FlaskRequest):
    """Keep accepted upload bodies in memory, including multipart file parts."""

    def _get_file_stream(
        self, total_content_length, content_type, filename=None, content_length=None
    ):
        return BytesIO()


def career_postings_directory():
    configured = os.environ.get("CAREERLENS_JOB_POSTINGS_DIR", "").strip()
    if configured:
        return Path(configured).expanduser()
    return ROOT.parent / "CareerLens-backend" / "app" / "modules" / "job_postings"


def career_posting_categories(directory):
    """Read optional source taxonomy without following Markdown links or changing fixtures."""
    index = directory / "00_목록.md"
    if not index.is_file() or index.is_symlink():
        return {}
    if index.stat().st_size > 1024 * 1024:
        raise ValueError("Job posting index size limit exceeded.")
    categories, columns = {}, None
    for line in index.read_text(encoding="utf-8-sig").splitlines():
        if not line.strip().startswith("|"):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if all(name in cells for name in ("번호", "직무 유형", "파일")):
            columns = {name: cells.index(name) for name in ("번호", "직무 유형", "파일")}
            continue
        if not columns or len(cells) <= max(columns.values()):
            continue
        number = cells[columns["번호"]]
        category = cells[columns["직무 유형"]]
        link = re.fullmatch(r"\[[^\]]*\]\(([0-9]+)\.md\)", cells[columns["파일"]])
        if (
            not number.isascii()
            or not number.isdigit()
            or not link
            or int(number) != int(link[1])
            or not category
        ):
            continue
        categories[f"{link[1]}.md"] = category
    return categories


def load_career_markdown(directory):
    """Expose only the configured repository's numbered fictional posting fixtures."""
    if not directory.is_dir():
        raise FileNotFoundError("Job posting directory does not exist.")
    files = sorted(
        (
            path
            for path in directory.glob("*.md")
            if path.is_file()
            and not path.is_symlink()
            and path.stem.isascii()
            and path.stem.isdigit()
        ),
        key=lambda path: int(path.stem),
    )
    if not files:
        raise ValueError("No numbered Markdown job postings were found.")
    categories = career_posting_categories(directory)
    items, total_size = [], 0
    for path in files:
        size = path.stat().st_size
        total_size += size
        if size > 1024 * 1024 or total_size > 10 * 1024 * 1024:
            raise ValueError("Job posting Markdown size limit exceeded.")
        items.append(
            {
                "id": path.stem,
                "filename": path.name,
                "content": path.read_text(encoding="utf-8-sig"),
                **({"role_category": categories[path.name]} if path.name in categories else {}),
            }
        )
    return {"items": items}


def load_career_catalog():
    """Keep local sources authoritative; use the public snapshot in standalone deployments."""
    directory = career_postings_directory()
    if os.environ.get("CAREERLENS_JOB_POSTINGS_DIR", "").strip() or directory.exists():
        return load_career_markdown(directory)
    snapshot = ROOT / "data" / "career-postings.json"
    if snapshot.stat().st_size > 10 * 1024 * 1024:
        raise ValueError("Bundled job posting size limit exceeded.")
    catalog = json.loads(snapshot.read_text(encoding="utf-8"))
    if not isinstance(catalog, dict) or not isinstance(catalog.get("items"), list) or not catalog["items"]:
        raise ValueError("Bundled job postings are missing.")
    return catalog


def guest_catalog_job(job_id):
    """Resolve only server-owned public fixtures, never a client-supplied job body."""
    match = re.fullmatch(r"(?:backup-)?([0-9]{1,6})", str(job_id))
    if not match:
        raise NotFound()
    item = next((item for item in load_career_catalog()["items"]
                 if str(item.get("id", "")).isdigit()
                 and int(item["id"]) == int(match[1])), None)
    if item is None or not isinstance(item.get("content"), str):
        raise NotFound()
    markdown = item["content"]

    def field(label):
        value = re.search(r"^\s*-\s*\*\*" + re.escape(label) + r":\*\*\s*(.+)$", markdown, re.MULTILINE)
        return value[1].strip() if value else ""

    return {
        "id": f"backup-{item['id']}",
        "title": field("직무명") or field("공고명") or "선택한 채용공고",
        "company_name": field("회사명"),
        "description": markdown,
        "source_type": "fictional",
        "is_fictional": True,
        "role_category": item.get("role_category", ""),
    }


def load_local_env(path):
    """Read simple KEY=value settings without overriding the process environment."""
    if not path.exists():
        return
    for number, line in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if not separator or not re.fullmatch(r"[A-Z_][A-Z0-9_]*", key):
            raise ValueError(f"Invalid .env setting on line {number}; use KEY=value.")
        if value[:1] in ('"', "'"):
            if len(value) < 2 or value[-1] != value[0]:
                raise ValueError(f"Unclosed .env value on line {number}.")
            value = value[1:-1]
        os.environ.setdefault(key, value)


def validate_origin(value):
    """Only a fixed operator-configured HTTPS origin or local HTTP is accepted."""
    if any(char.isspace() for char in value):
        raise ValueError("API origin must not contain whitespace.")
    value = value.rstrip("/")
    parsed = urlsplit(value)
    try:
        port = parsed.port
    except ValueError as error:
        raise ValueError("API origin has an invalid port.") from error
    if (
        not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path
        or parsed.query
        or parsed.fragment
        or parsed.scheme not in ("http", "https")
        or (port is not None and port < 1)
    ):
        raise ValueError(
            "Use an HTTP(S) origin only, without a path, credentials, query or fragment."
        )
    hostname = parsed.hostname
    try:
        ipaddress.ip_address(hostname)
    except ValueError:
        try:
            hostname = hostname.encode("idna").decode("ascii")
        except UnicodeError as error:
            raise ValueError("API origin has an invalid hostname.") from error
        if len(hostname) > 253 or not all(
            re.fullmatch(r"[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?", label)
            for label in hostname.rstrip(".").split(".")
        ):
            raise ValueError("API origin has an invalid hostname.")
    if parsed.scheme == "http" and parsed.hostname not in ("127.0.0.1", "localhost", "::1"):
        raise ValueError(
            "HTTP is supported only for loopback development APIs. Use HTTPS for remote APIs."
        )
    authority = f"[{hostname}]" if ":" in hostname else hostname
    if port is not None:
        authority += f":{port}"
    return f"{parsed.scheme}://{authority}"


def frontend_cookie(value):
    # The response belongs to the frontend host. Preserve all security attributes.
    return re.sub(r";\s*Domain\s*=\s*[^;]*", "", value, flags=re.IGNORECASE)


def frontend_redirect(value, backend_origin):
    """Keep API-owned redirects same-origin; OAuth provider redirects stay intact."""
    destination, backend = urlsplit(value), urlsplit(backend_origin)
    if not destination.netloc:
        return value
    try:
        destination_scheme = destination.scheme or backend.scheme
        same_origin = (
            destination_scheme == backend.scheme
            and destination.hostname == backend.hostname
            and (destination.port or (443 if destination_scheme == "https" else 80))
            == (backend.port or (443 if backend.scheme == "https" else 80))
        )
    except ValueError:
        return value
    if same_origin:
        return urlunsplit(
            ("", "", destination.path or "/", destination.query, destination.fragment)
        )
    return value


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def create_app(backend_url=None):
    app = Flask(__name__, static_folder=None)
    app.request_class = InMemoryUploadRequest
    app.config.update(
        MAX_CONTENT_LENGTH=11 * 1024 * 1024, TRUSTED_HOSTS=["127.0.0.1", "localhost", "[::1]"]
    )
    configured = backend_url if backend_url is not None else os.environ.get("BACKEND_URL", "")
    origin = validate_origin(configured) if configured else None
    on_render = os.environ.get("RENDER") == "true"
    if on_render and origin:
        backend = urlsplit(origin)
        try:
            loopback = ipaddress.ip_address(backend.hostname).is_loopback
        except ValueError:
            loopback = backend.hostname == "localhost"
        if backend.scheme != "https" or loopback:
            raise ValueError("Render BACKEND_URL must be the deployed API's HTTPS origin, not localhost.")
    public_origins = [os.environ.get("FRONTEND_PUBLIC_ORIGIN", "")]
    if on_render:
        public_origins.append(os.environ.get("RENDER_EXTERNAL_URL", ""))
    for public_origin in public_origins:
        if public_origin:
            app.config["TRUSTED_HOSTS"].append(urlsplit(validate_origin(public_origin)).hostname)
    opener = build_opener(ProxyHandler({}), NoRedirect())

    def verify_guest_report_owner(authorization):
        # Authentication is still verified by the current backend. No service
        # account, decoded-but-unverified JWT, or browser-supplied owner is used.
        if not origin:
            raise ServiceUnavailable()
        if not isinstance(authorization, str) or not authorization.startswith("Bearer "):
            raise Unauthorized()
        try:
            with opener.open(Request(origin + "/api/v1/me", headers={
                "Authorization": authorization, "Accept": "application/json",
            }), timeout=15) as response:
                if response.code != 200:
                    raise Unauthorized()
                profile = json.loads(response.read())
            return str(UUID(str(profile["user_id"])))
        except HTTPError as error:
            if error.code in {401, 403}:
                raise Unauthorized() from None
            raise ServiceUnavailable() from None
        except (ValueError, KeyError, TypeError):
            raise Unauthorized() from None
        except (URLError, TimeoutError, OSError):
            raise ServiceUnavailable() from None

    guest_api = create_guest_blueprint(
        ROOT / ".runtime" / "guest-reports.sqlite3",
        fetch_job=guest_catalog_job,
        verify_user=verify_guest_report_owner,
        available=lambda: bool(origin) and os.environ.get("CAREERLENS_GUEST_ANALYSIS", "1") != "0" and engine_available(),
    )
    app.register_blueprint(guest_api)
    app.extensions["guest_analysis"] = guest_api.guest_service

    @app.get("/")
    def index():
        return send_from_directory(ROOT / "public", "index.html")

    @app.get("/design-lab")
    def design_lab():
        """Isolated synthetic visual comparisons; no workspace or account data."""
        return send_from_directory(ROOT / "public", "design-lab.html")

    @app.get("/motion-preview")
    def motion_preview():
        """Actual motion modules with synthetic progress and no analysis requests."""
        return send_from_directory(ROOT / "public", "motion-preview.html")

    @app.get("/health")
    def health():
        return jsonify(status="ok", service="careerlens-frontend", backend_configured=bool(origin))

    @app.get("/api/v1/local-data/career-markdown")
    def career_markdown():
        try:
            return jsonify(load_career_catalog())
        except (OSError, UnicodeError, ValueError):
            return (
                jsonify(
                    error={
                        "code": "career_markdown_unavailable",
                        "message": "채용공고를 불러오지 못했습니다. 잠시 후 다시 불러와 주세요.",
                    }
                ),
                503,
            )

    @app.post("/api/v1/local-data/convert-resume")
    def convert_resume():
        upload = request.files.get("file")
        if upload is None or not upload.filename:
            return (
                jsonify(error={"code": "file_required", "message": "이력서 파일을 선택해 주세요."}),
                400,
            )
        filename = Path(upload.filename.replace("\\", "/")).name
        if Path(filename).suffix.lower() not in {".pdf", ".docx", ".txt", ".md"}:
            return (
                jsonify(
                    error={
                        "code": "unsupported_file",
                        "message": "PDF, DOCX, TXT, MD 파일을 선택해 주세요.",
                    }
                ),
                415,
            )
        data = upload.read(MAX_UPLOAD_BYTES + 1)
        if len(data) > MAX_UPLOAD_BYTES:
            return too_large(None)
        try:
            text = extract_resume(filename, data)
        except ValueError as error:
            message = str(error)
            if message not in RESUME_VALIDATION_MESSAGES:
                message = "이력서 파일을 읽지 못했습니다. 내용을 확인하거나 본문 붙여넣기를 이용해 주세요."
            return jsonify(error={"code": "invalid_resume", "message": message}), 400
        return jsonify(filename=Path(filename).stem[:180] + ".md", text=text)

    @app.get("/favicon.svg")
    def favicon():
        return send_from_directory(ROOT / "public", "favicon.svg")

    @app.get("/src/<path:name>")
    def source(name):
        if Path(name).suffix.lower() not in {".js", ".css", ".svg", ".png", ".jpg", ".woff2"}:
            return "", 404
        response = send_from_directory(ROOT / "src", name)
        if name.endswith(".js"):
            response.mimetype = "text/javascript"
        return response

    @app.get("/public/<path:name>")
    def public(name):
        if Path(name).suffix.lower() not in {".svg", ".png", ".jpg", ".ico", ".webp"}:
            return "", 404
        return send_from_directory(ROOT / "public", name)

    @app.route("/api/<path:name>", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    def api(name):
        if not origin:
            return (
                jsonify(
                    error={
                        "code": "backend_unconfigured",
                        "message": PUBLIC_ERRORS["service_unavailable"],
                    }
                ),
                503,
            )
        target = origin + request.path
        if request.query_string:
            target += "?" + request.query_string.decode("ascii")
        # urllib creates Host from the target API origin (essential for HTTPS virtual hosts).
        allowed = {
            "content-type",
            "cookie",
            "x-csrf-token",
            "origin",
            "accept",
            "authorization",
            "idempotency-key",
            "last-event-id",
        }
        headers = {key: value for key, value in request.headers if key.lower() in allowed}
        payload = request.get_data() if request.method not in {"GET", "HEAD"} else None
        upstream_request = Request(target, data=payload, headers=headers, method=request.method)
        try:
            try:
                upstream = opener.open(upstream_request, timeout=60)
            except HTTPError as error:
                upstream = error
            with upstream:
                failed = upstream.code >= 400
                if failed:
                    response = jsonify(public_api_error(upstream.code, request.path, upstream.read()))
                    response.status_code = upstream.code
                else:
                    body = upstream.read()
                    progress_path = re.fullmatch(r"/api/v1/evaluations/[^/]+(?:/(progress|events))?", request.path)
                    if request.method == "GET" and progress_path:
                        try:
                            if progress_path[1] == "events":
                                body = public_evaluation_events(body)
                            else:
                                body = json.dumps(public_evaluation_progress(json.loads(body)), ensure_ascii=False).encode("utf-8")
                        except (ValueError, TypeError, UnicodeError):
                            return jsonify(public_api_error(502)), 502
                    response = Response(body, status=upstream.code)
                forwarded = {
                    "content-type",
                    "set-cookie",
                    "location",
                    "cache-control",
                    "retry-after",
                }
                for key in forwarded:
                    if failed and key in {"content-type", "location"}:
                        continue
                    values = upstream.headers.get_all(key, [])
                    if values:
                        response.headers.pop(key, None)
                        for value in values:
                            if key == "set-cookie":
                                value = frontend_cookie(value)
                            elif key == "location":
                                value = frontend_redirect(value, origin)
                            response.headers.add(key, value)
                return response
        except (URLError, TimeoutError, OSError):
            return (
                jsonify(
                    error={
                        "code": "backend_unavailable",
                        "message": PUBLIC_ERRORS["service_unavailable"],
                    }
                ),
                502,
            )

    @app.errorhandler(413)
    def too_large(_):
        return (
            jsonify(error={"code": "file_too_large", "message": "10MB 이하 파일을 선택해 주세요."}),
            413,
        )

    @app.errorhandler(Exception)
    def unexpected_error(error):
        status = error.code if isinstance(error, HTTPException) else 500
        if request.path.startswith("/api/"):
            return jsonify(public_api_error(status, request.path)), status
        if isinstance(error, HTTPException):
            return error.get_response()
        return PUBLIC_ERRORS["service_unavailable"], 500

    @app.after_request
    def security_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        )
        return response

    return app


if __name__ == "__main__":
    load_local_env(ROOT / ".env")
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("FRONTEND_PORT") or os.environ.get("PORT") or "5100"),
    )
    parser.add_argument("--host", default=os.environ.get("FRONTEND_HOST") or "127.0.0.1")
    parser.add_argument("--backend-url", default=None)
    args = parser.parse_args()
    # Keep accepted resume request bodies below Waitress's disk-spool threshold.
    serve(
        create_app(args.backend_url),
        host=args.host,
        port=args.port,
        inbuf_overflow=12 * 1024 * 1024,
        max_request_body_size=11 * 1024 * 1024,
    )
