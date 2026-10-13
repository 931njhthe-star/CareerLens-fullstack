"""Private, expiring guest analysis and authenticated frontend report storage.

The browser receives progress only until a verified member claims a completed
run. The runner is injected so this module never needs model or database keys.
"""

import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timezone
from hashlib import sha256
import json
import math
from pathlib import Path
import secrets
import sqlite3
import threading
import time
from urllib.parse import urlsplit
from uuid import UUID, uuid4

from flask import Blueprint, jsonify, request
from werkzeug.exceptions import HTTPException


PREFIX = "/api/v1/local-guest"
COOKIE = "career_lens_guest_analysis"
FINAL = {"completed", "partial"}
FLOW_NODES = {"parse_resume", "parse_job", "indexing", "domain_a", "domain_b", "domain_c", "domain_d", "validation", "scoring", "guest_store"}


def safe_flow_event(value):
    """Privacy boundary: never retain provider text, result payloads or IDs."""
    if not isinstance(value, dict) or not isinstance(value.get("node"), str) or value["node"] not in FLOW_NODES or not isinstance(value.get("state"), str) or value["state"] not in {"running", "complete"}:
        return None
    node = value["node"]
    output = {"node": node, "state": value["state"]}
    if node.startswith("domain_"):
        criterion = value.get("criterion")
        if not isinstance(criterion, str) or criterion not in {node[-1].upper() + str(number) for number in (1, 2, 3)}:
            return None
        output["criterion"] = criterion
    duration = value.get("durationMs")
    if isinstance(duration, (int, float)) and not isinstance(duration, bool) and math.isfinite(duration) and 0 <= duration <= 86400000:
        output["durationMs"] = duration
    return output


def read_flow_events(serialized):
    try:
        rows = json.loads(serialized or "[]")
    except (ValueError, TypeError):
        return []
    if not isinstance(rows, list):
        return []
    output = []
    for row in rows[-100:]:
        event = safe_flow_event(row)
        ident = row.get("id") if isinstance(row, dict) else None
        if event and type(ident) is int and 0 < ident <= 9007199254740991:
            output.append({"id": ident, **event})
    return output


def append_flow_event(serialized, value):
    events = read_flow_events(serialized)
    event = safe_flow_event(value)
    if event:
        previous = next((row for row in reversed(events) if (row["node"], row.get("criterion")) == (event["node"], event.get("criterion"))), None)
        if previous is None or previous["state"] != event["state"]:
            events.append({"id": events[-1]["id"] + 1 if events else 1, **event})
    return json.dumps(events[-100:], allow_nan=False)


MESSAGES = {
    "invalid_request": "입력한 내용을 확인하고 다시 시도해 주세요.",
    "unauthorized": "로그인한 뒤 결과를 확인해 주세요.",
    "not_found": "임시 분석 또는 보고서를 찾을 수 없습니다.",
    "guest_expired": "임시 보관 시간이 만료되었습니다. 이력서를 다시 준비해 주세요.",
    "conflict": "현재 상태에서는 요청을 완료할 수 없습니다. 분석 상태를 다시 확인해 주세요.",
    "rate_limited": "분석 요청이 많습니다. 잠시 후 다시 시도해 주세요.",
    "service_unavailable": "분석 서비스를 잠시 이용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    "forbidden": "요청한 페이지에서 다시 시도해 주세요.",
}


def stamp(value):
    return datetime.fromtimestamp(value, timezone.utc).isoformat()


def digest(value):
    return sha256(value.encode("utf-8")).hexdigest()


class GuestError(Exception):
    def __init__(self, status, code):
        self.status, self.code = status, code


class GuestAnalysisService:
    def __init__(self, store_path, fetch_job, verify_user, runner, available, *,
                 ttl_seconds=1800, timeout_seconds=900, max_active=2, max_queued=4, observer=None):
        self.path = Path(store_path)
        self.fetch_job, self.verify_user = fetch_job, verify_user
        self.runner, self.available = runner, available
        self.observer = observer
        self.ttl, self.timeout = ttl_seconds, timeout_seconds
        self.max_active = max_active
        self._clock = time.time
        self._lock = threading.RLock()
        self._initialized = False
        self._executor = None
        self._capacity = threading.BoundedSemaphore(max_active + max_queued)
        self._stop = threading.Event()
        self._janitor = None

    def observe(self, run_id, node, state, **fields):
        # Only structural measurements leave this service, never input/result data.
        try:
            if self.observer:
                self.observer(run_id, node, state, **fields)
        except Exception:
            pass  # Monitoring must not turn a successful analysis into a failure.

    @contextmanager
    def connect(self):
        with self._lock:
            if not self._initialized:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                with sqlite3.connect(self.path, timeout=10) as db:
                    db.execute("PRAGMA journal_mode=WAL")
                    db.execute("PRAGMA secure_delete=ON")
                    db.execute("""CREATE TABLE IF NOT EXISTS guest_analyses (
                        id TEXT PRIMARY KEY, guest_hash TEXT NOT NULL,
                        owner_user TEXT, idempotency_key TEXT NOT NULL,
                        fingerprint TEXT NOT NULL, ip_hash TEXT NOT NULL,
                        status TEXT NOT NULL, stage TEXT NOT NULL,
                        progress REAL NOT NULL DEFAULT 0,
                        created REAL NOT NULL, expires REAL NOT NULL,
                        completed REAL, job_id TEXT NOT NULL,
                        job_summary TEXT NOT NULL, result TEXT,
                        UNIQUE(guest_hash, idempotency_key)
                    )""")
                    db.execute("CREATE INDEX IF NOT EXISTS guest_owner ON guest_analyses(owner_user, created)")
                    columns = {row[1] for row in db.execute("PRAGMA table_info(guest_analyses)")}
                    if "flow_events" not in columns:
                        db.execute("ALTER TABLE guest_analyses ADD COLUMN flow_events TEXT NOT NULL DEFAULT '[]'")
                    if "analysis_duration_ms" not in columns:
                        db.execute("ALTER TABLE guest_analyses ADD COLUMN analysis_duration_ms REAL")
                    db.execute("CREATE TABLE IF NOT EXISTS guest_sessions (guest_hash TEXT PRIMARY KEY, expires REAL NOT NULL)")
                    db.execute("CREATE TABLE IF NOT EXISTS guest_admissions (guest_hash TEXT NOT NULL, ip_hash TEXT NOT NULL, created REAL NOT NULL)")
                    db.execute("CREATE TABLE IF NOT EXISTS guest_cancelled_requests (guest_hash TEXT NOT NULL, request_key TEXT NOT NULL, expires REAL NOT NULL, PRIMARY KEY(guest_hash,request_key))")
                    # A server restart must never silently rerun a paid job.
                    db.execute("UPDATE guest_analyses SET status='failed', stage='failed' WHERE status IN ('queued','running')")
                db.close()
                self._initialized = True
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA secure_delete=ON")
        try:
            with db:
                yield db
        finally:
            db.close()

    def cleanup(self):
        with self.connect() as db:
            db.execute("DELETE FROM guest_analyses WHERE owner_user IS NULL AND expires <= ?", (self._clock(),))
            db.execute("DELETE FROM guest_admissions WHERE created <= ?", (self._clock() - self.ttl,))
            db.execute("DELETE FROM guest_sessions WHERE expires <= ?", (self._clock(),))
            db.execute("DELETE FROM guest_cancelled_requests WHERE expires <= ?", (self._clock(),))

    def start_workers(self):
        with self._lock:
            if self._executor is None:
                self._executor = ThreadPoolExecutor(max_workers=self.max_active, thread_name_prefix="guest-analysis")
                def prune():
                    while not self._stop.wait(30):
                        try:
                            self.cleanup()
                        except sqlite3.Error:
                            pass
                self._janitor = threading.Thread(target=prune, name="guest-analysis-expiry", daemon=True)
                self._janitor.start()

    def shutdown(self, wait=True):
        self._stop.set()
        if self._executor:
            self._executor.shutdown(wait=wait, cancel_futures=True)

    def is_available(self):
        try:
            return bool(self.available())
        except Exception:
            return False

    def session(self, create=False):
        token = request.cookies.get(COOKIE, "")
        if not token or len(token) != 64 or any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_" for c in token):
            if not create:
                raise GuestError(404, "not_found")
            token = secrets.token_urlsafe(48)
        return token, digest(token)

    def user(self):
        authorization = request.headers.get("Authorization", "")
        if not authorization.startswith("Bearer ") or len(authorization) > 8192:
            raise GuestError(401, "unauthorized")
        bearer = authorization[7:].strip()
        if not bearer:
            raise GuestError(401, "unauthorized")
        try:
            uid = self.verify_user("Bearer " + bearer)
        except HTTPException as error:
            if error.code and error.code >= 500:
                raise GuestError(503, "service_unavailable") from None
            raise GuestError(401, "unauthorized") from None
        except Exception:
            raise GuestError(401, "unauthorized") from None
        if not isinstance(uid, str) or not uid or len(uid) > 200:
            raise GuestError(401, "unauthorized")
        return uid

    def owned_guest(self, run_id):
        try:
            if str(UUID(run_id)) != run_id:
                raise ValueError()
        except ValueError:
            raise GuestError(404, "not_found") from None
        _, key = self.session()
        with self.connect() as db:
            row = db.execute("SELECT * FROM guest_analyses WHERE id=? AND guest_hash=?", (run_id, key)).fetchone()
        if row is None:
            raise GuestError(404, "not_found")
        if row["expires"] <= self._clock():
            self.cleanup()
            raise GuestError(410, "guest_expired")
        return row

    @staticmethod
    def metadata(row):
        return {
            "run_id": row["id"], "status": row["status"],
            "current_stage": row["stage"], "progress_percent": row["progress"],
            "created_at": stamp(row["created"]),
            "completed_at": stamp(row["completed"]) if row["completed"] else None,
            "expires_at": stamp(row["expires"]), "completed": row["status"] in FINAL,
            "report_locked": True, "storage_origin": "frontend_guest",
            "flow_events": read_flow_events(row["flow_events"]),
            "analysis_duration_ms": row["analysis_duration_ms"],
        }

    @staticmethod
    def report(row):
        result = json.loads(row["result"])
        return {**result, "run_id": row["id"], "job_id": row["job_id"],
                "job_summary": json.loads(row["job_summary"]), "storage_origin": "frontend_guest"}

    def create(self, data, idem):
        if not isinstance(data, dict) or not isinstance(idem, str) or not 1 <= len(idem) <= 128:
            raise GuestError(400, "invalid_request")
        resume, job_id = data.get("resume_text"), data.get("job_id")
        if not isinstance(resume, str) or not resume.strip() or len(resume) > 50000 or "\x00" in resume:
            raise GuestError(422, "invalid_request")
        if not isinstance(job_id, str) or not job_id or len(job_id) > 150:
            raise GuestError(422, "invalid_request")
        now = self._clock()
        expires = now + self.ttl
        if data.get("expires_at"):
            try:
                parsed = datetime.fromisoformat(data["expires_at"].replace("Z", "+00:00"))
                if parsed.tzinfo is None:
                    raise ValueError()
                expires = min(expires, parsed.timestamp())
            except (TypeError, ValueError, AttributeError):
                raise GuestError(422, "invalid_request") from None
        if expires <= now:
            raise GuestError(410, "guest_expired")
        token, key = self.session(create=True)
        fingerprint = digest(json.dumps([resume, job_id], ensure_ascii=False))
        ip_key = digest(request.remote_addr or "unknown")
        self.cleanup()
        # Serialize admission checks and reservations; no paid work is started
        # before a durable unique idempotency record exists.
        with self._lock:
            with self.connect() as db:
                if db.execute("SELECT 1 FROM guest_cancelled_requests WHERE guest_hash=? AND request_key=? AND expires>?", (key, idem, now)).fetchone():
                    raise GuestError(409, "conflict")
                existing = db.execute("SELECT * FROM guest_analyses WHERE guest_hash=? AND idempotency_key=?", (key, idem)).fetchone()
                if existing:
                    if existing["fingerprint"] != fingerprint:
                        raise GuestError(409, "conflict")
                    return existing, token
                session_row = db.execute("SELECT expires FROM guest_sessions WHERE guest_hash=?", (key,)).fetchone()
                if session_row is not None:
                    expires = min(expires, session_row[0])
                if expires <= now:
                    raise GuestError(410, "guest_expired")
                active = db.execute("SELECT 1 FROM guest_analyses WHERE guest_hash=? AND status IN ('queued','running')", (key,)).fetchone()
                session_count = db.execute("SELECT COUNT(*) FROM guest_admissions WHERE guest_hash=? AND created>?", (key, now - self.ttl)).fetchone()[0]
                ip_count = db.execute("SELECT COUNT(*) FROM guest_admissions WHERE ip_hash=? AND created>?", (ip_key, now - self.ttl)).fetchone()[0]
                if active or session_count >= 3 or ip_count >= 8:
                    raise GuestError(429, "rate_limited")
            if not self.is_available():
                raise GuestError(503, "service_unavailable")
            if not self._capacity.acquire(blocking=False):
                raise GuestError(429, "rate_limited")
            try:
                job = self.fetch_job(job_id)
                if not isinstance(job, dict) or not job.get("description"):
                    raise GuestError(404, "not_found")
                # Only server-fetched job content reaches the engine.
                summary = {"id": job.get("id", job_id), "title": job.get("title", ""),
                           "company_name": job.get("company_name", ""), "location": job.get("location", "")}
                run_id = str(uuid4())
                with self.connect() as db:
                    db.execute("INSERT OR IGNORE INTO guest_sessions (guest_hash,expires) VALUES (?,?)", (key, expires))
                    db.execute("INSERT INTO guest_admissions (guest_hash,ip_hash,created) VALUES (?,?,?)", (key, ip_key, now))
                    db.execute("""INSERT INTO guest_analyses
                        (id,guest_hash,idempotency_key,fingerprint,ip_hash,status,stage,created,expires,job_id,job_summary)
                        VALUES (?,?,?,?,?,'queued','queued',?,?,?,?)""",
                        (run_id, key, idem, fingerprint, ip_key, now, expires, str(summary["id"]), json.dumps(summary, ensure_ascii=False)))
                    row = db.execute("SELECT * FROM guest_analyses WHERE id=?", (run_id,)).fetchone()
                self.observe(run_id, "queue", "pending", publisher=request.headers.get("X-CareerLens-Flow-Publisher"))
                self.start_workers()
                self._executor.submit(self.work, run_id, resume, job)
                return row, token
            except GuestError:
                self._capacity.release()
                raise
            except HTTPException as error:
                self._capacity.release()
                if error.code == 404:
                    raise GuestError(404, "not_found") from None
                raise GuestError(503, "service_unavailable") from None
            except Exception:
                self._capacity.release()
                raise GuestError(503, "service_unavailable") from None

    def work(self, run_id, resume, job):
        def cancelled():
            if self._stop.is_set():
                return True
            with self.connect() as db:
                row = db.execute("SELECT status,expires FROM guest_analyses WHERE id=?", (run_id,)).fetchone()
            return not row or row["expires"] <= self._clock() or row["status"] not in {"queued", "running"}

        async def progress(stage, percent, flow_event=None):
            if cancelled():
                raise asyncio.CancelledError()
            # Stage is an enum-like code. Never forward a provider message.
            safe_stage = stage if stage in {"parsing", "parse_resume", "parse_job", "indexing", "evaluation", "criterion", "validation", "scoring", "reporting", "completed"} else "evaluation"
            if not isinstance(percent, (int, float)) or isinstance(percent, bool) or not 0 <= percent <= 100:
                return
            with self.connect() as db:
                row = db.execute("SELECT flow_events FROM guest_analyses WHERE id=?", (run_id,)).fetchone()
                updated = None
                if row:
                    # guest_store is reserved for the successful durable write;
                    # even a runner callback cannot claim that persistence ran.
                    event = flow_event if isinstance(flow_event, dict) and flow_event.get("node") != "guest_store" else None
                    updated = db.execute("UPDATE guest_analyses SET stage=?,progress=MAX(progress,?),flow_events=? WHERE id=? AND status='running' AND expires>?",
                               (safe_stage, min(percent, 99), append_flow_event(row["flow_events"], event), run_id, self._clock()))
            if not updated or not updated.rowcount:
                raise asyncio.CancelledError()
            await asyncio.to_thread(self.observe, run_id, "analysis", "running", progress=min(percent, 99))
            safe_event = safe_flow_event(event) if row else None
            if safe_event:
                await asyncio.to_thread(self.observe, run_id, safe_event["node"], safe_event["state"],
                                        criterion=safe_event.get("criterion"))

        async def run():
            return await asyncio.wait_for(self.runner(resume, job, run_id, progress, cancelled), timeout=self.timeout)

        try:
            if cancelled():
                self.observe(run_id, "analysis", "cancelled")
                return
            with self.connect() as db:
                admitted = db.execute("UPDATE guest_analyses SET status='running',stage='parsing' WHERE id=? AND status='queued' AND expires>?", (run_id, self._clock()))
            if not admitted.rowcount:
                self.observe(run_id, "analysis", "cancelled")
                return
            started = time.monotonic()
            self.observe(run_id, "queue", "complete")
            self.observe(run_id, "analysis", "running", progress=0)
            result = asyncio.run(run())
            if cancelled():
                self.observe(run_id, "analysis", "cancelled")
                return
            if not isinstance(result, dict) or result.get("status") not in FINAL or not isinstance(result.get("report_text"), str) or not result["report_text"].strip() or not isinstance(result.get("scores"), dict):
                raise ValueError("Invalid analysis result")
            safe = {key: result[key] for key in ("status", "report_text", "report_data", "scores", "criteria", "model_name", "created_at", "completed_at") if key in result}
            safe["run_id"] = run_id
            safe["resume_text"] = resume
            safe["job_snapshot"] = job
            with self.connect() as db:
                row = db.execute("SELECT flow_events FROM guest_analyses WHERE id=?", (run_id,)).fetchone()
                if row:
                    # Readers see this event only after the result transaction
                    # commits. Engine completion/100% alone never creates it.
                    events = append_flow_event(row["flow_events"], {"node": "guest_store", "state": "complete"})
                    saved = db.execute("UPDATE guest_analyses SET status=?,stage='completed',progress=100,result=?,completed=?,flow_events=?,analysis_duration_ms=? WHERE id=? AND status='running' AND expires>?",
                               (result["status"], json.dumps(safe, ensure_ascii=False, allow_nan=False), self._clock(), events,
                                max(0, (time.monotonic() - started) * 1000), run_id, self._clock()))
                else:
                    saved = None
            if saved and saved.rowcount:
                self.observe(run_id, "guest_store", "complete")
                self.observe(run_id, "analysis", "partial" if result["status"] == "partial" else "complete", progress=100)
        except (Exception, asyncio.CancelledError):
            with self.connect() as db:
                failed = db.execute("UPDATE guest_analyses SET status='failed',stage='failed',result=NULL,completed=? WHERE id=? AND status IN ('queued','running')", (self._clock(), run_id))
            self.observe(run_id, "analysis", "failed" if failed.rowcount else "cancelled")
        finally:
            self._capacity.release()
            self.cleanup()


def create_guest_blueprint(
    store_path, fetch_job, verify_user, runner=None, available=None, reports_available=True, **options
):
    if runner is None or available is None:
        if __package__:
            from .guest_analysis_engine import engine_available, run_analysis
        else:
            from guest_analysis_engine import engine_available, run_analysis
        runner = runner or run_analysis
        available = available or engine_available
    service = GuestAnalysisService(store_path, fetch_job, verify_user, runner, available, **options)
    blueprint = Blueprint("local_guest_analysis", __name__, url_prefix=PREFIX)
    blueprint.guest_service = service

    @blueprint.before_request
    def protect_origin():
        if request.method not in {"POST", "DELETE"}:
            return None
        origin = request.headers.get("Origin")
        if origin:
            parsed = urlsplit(origin)
            actual = urlsplit(request.host_url)
            if (parsed.scheme, parsed.netloc) != (actual.scheme, actual.netloc) or parsed.path not in {"", "/"}:
                raise GuestError(403, "forbidden")
        if request.headers.get("Sec-Fetch-Site") == "cross-site":
            raise GuestError(403, "forbidden")
        if request.method == "POST" and not request.is_json:
            raise GuestError(415, "invalid_request")

    @blueprint.after_request
    def private_response(response):
        response.headers["Cache-Control"] = "no-store"
        response.headers["Pragma"] = "no-cache"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @blueprint.errorhandler(GuestError)
    def guest_error(error):
        return jsonify({"error": {"code": error.code, "message": MESSAGES[error.code]}}), error.status

    @blueprint.errorhandler(Exception)
    def internal_error(error):
        return jsonify({"error": {"code": "service_unavailable", "message": MESSAGES["service_unavailable"]}}), 503

    @blueprint.get("/capabilities")
    def capabilities():
        response = jsonify(
            {
                "available": service.is_available(),
                "reports_available": reports_available,
                "storage_origin": "frontend_guest",
                "guest_ttl_seconds": service.ttl,
            }
        )
        # Establish the capability before the first double-clickable action,
        # without creating a database or starting any analysis worker.
        token, _ = service.session(create=True)
        response.set_cookie(COOKIE, token, max_age=service.ttl, httponly=True,
                            secure=request.is_secure, samesite="Strict", path=PREFIX)
        return response

    @blueprint.post("/analyses")
    def create_analysis():
        if request.content_length and request.content_length > 250000:
            raise GuestError(413, "invalid_request")
        row, token = service.create(request.get_json(silent=True), request.headers.get("Idempotency-Key"))
        response = jsonify(service.metadata(row))
        response.status_code = 202
        response.set_cookie(COOKIE, token, max_age=max(1, int(row["expires"] - service._clock())),
                            httponly=True, secure=request.is_secure, samesite="Strict", path=PREFIX)
        return response

    @blueprint.get("/analyses/<run_id>")
    def analysis(run_id):
        return jsonify(service.metadata(service.owned_guest(run_id)))

    @blueprint.post("/analyses/cancel-pending")
    def cancel_pending():
        # The browser can cancel an accepted request even when its creation
        # response/run ID was lost. A tombstone also disarms a late POST.
        data = request.get_json(silent=True)
        key = data.get("idempotency_key") if isinstance(data, dict) else None
        if not isinstance(key, str) or not 1 <= len(key) <= 128:
            raise GuestError(400, "invalid_request")
        _, guest_hash = service.session()
        with service._lock, service.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            runs = db.execute("SELECT id FROM guest_analyses WHERE guest_hash=? AND idempotency_key=? AND owner_user IS NULL", (guest_hash, key)).fetchall()
            db.execute("INSERT OR REPLACE INTO guest_cancelled_requests VALUES (?,?,?)", (guest_hash, key, service._clock() + service.ttl))
            db.execute("UPDATE guest_analyses SET status='cancelled',stage='cancelled',result=NULL,completed=? WHERE guest_hash=? AND idempotency_key=? AND owner_user IS NULL",
                       (service._clock(), guest_hash, key))
        for run in runs:
            service.observe(run["id"], "analysis", "cancelled")
        return jsonify({"cancelled": True})

    @blueprint.post("/analyses/<run_id>/cancel")
    def cancel(run_id):
        row = service.owned_guest(run_id)
        if row["owner_user"]:
            raise GuestError(409, "conflict")
        with service.connect() as db:
            changed = db.execute("UPDATE guest_analyses SET status='cancelled',stage='cancelled',result=NULL,completed=? WHERE id=? AND owner_user IS NULL", (service._clock(), run_id))
            if not changed.rowcount:
                raise GuestError(409, "conflict")
            row = db.execute("SELECT * FROM guest_analyses WHERE id=?", (run_id,)).fetchone()
        service.observe(run_id, "analysis", "cancelled")
        return jsonify(service.metadata(row))

    @blueprint.delete("/analyses/<run_id>")
    def discard(run_id):
        row = service.owned_guest(run_id)
        if row["owner_user"]:
            raise GuestError(409, "conflict")
        with service.connect() as db:
            changed = db.execute("DELETE FROM guest_analyses WHERE id=? AND owner_user IS NULL", (run_id,))
            if not changed.rowcount:
                raise GuestError(409, "conflict")
        service.observe(run_id, "analysis", "cancelled")
        return "", 204

    @blueprint.post("/analyses/<run_id>/claim")
    def claim(run_id):
        uid = service.user()
        row = service.owned_guest(run_id)
        with service.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM guest_analyses WHERE id=? AND guest_hash=?", (run_id, row["guest_hash"])).fetchone()
            if not row or row["expires"] <= service._clock():
                raise GuestError(410, "guest_expired")
            if row["owner_user"] and row["owner_user"] != uid:
                raise GuestError(409, "conflict")
            if row["status"] not in FINAL or not row["result"]:
                raise GuestError(409, "conflict")
            db.execute("UPDATE guest_analyses SET owner_user=? WHERE id=? AND (owner_user IS NULL OR owner_user=?)", (uid, run_id, uid))
        # The caller can use this backend-verified identity without another
        # serial /me round trip before displaying the already stored report.
        return jsonify({**service.report(row), "owner_user_id": uid})

    @blueprint.get("/reports")
    def reports():
        uid = service.user()
        service.cleanup()
        with service.connect() as db:
            rows = db.execute("SELECT * FROM guest_analyses WHERE owner_user=? AND status IN ('completed','partial') ORDER BY created DESC LIMIT 100", (uid,)).fetchall()
        output = []
        for row in rows:
            summary = json.loads(row["job_summary"])
            output.append({"run_id": row["id"], "status": row["status"], "created_at": stamp(row["created"]),
                           "completed_at": stamp(row["completed"]), "job_id": row["job_id"],
                           "title": summary.get("title", ""), "company_name": summary.get("company_name", ""),
                           "storage_origin": "frontend_guest"})
        return jsonify({"reports": output})

    @blueprint.route("/reports/<run_id>", methods=["GET", "DELETE"])
    def report(run_id):
        uid = service.user()
        with service.connect() as db:
            row = db.execute("SELECT * FROM guest_analyses WHERE id=? AND owner_user=? AND status IN ('completed','partial')", (run_id, uid)).fetchone()
            if not row or not row["result"]:
                raise GuestError(404, "not_found")
            if request.method == "DELETE":
                db.execute("DELETE FROM guest_analyses WHERE id=? AND owner_user=?", (run_id, uid))
                return "", 204
        return jsonify(service.report(row))

    return blueprint
