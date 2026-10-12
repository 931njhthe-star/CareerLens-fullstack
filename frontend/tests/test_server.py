"""No live API, database, credentials or external network needed."""

from email.message import Message
from pathlib import Path
import json
import os
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import URLError

import server


class UpstreamResponse:
    def __init__(self, status=200, headers=(), body=b'{"user":null}'):
        self.code = status
        self.headers = Message()
        self.headers["Content-Type"] = "application/json"
        for key, value in headers:
            self.headers[key] = value
        self.body = body

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


class Opener:
    def __init__(self, response=None, error=None):
        self.response = response or UpstreamResponse()
        self.error = error
        self.calls = []

    def open(self, request, timeout):
        self.calls.append((request, timeout))
        if self.error:
            raise self.error
        return self.response


class ServerTests(unittest.TestCase):
    def app(self, origin="", opener=None):
        with (
            patch.dict(os.environ, {}, clear=True),
            patch("server.build_opener", return_value=opener or Opener()),
        ):
            return server.create_app(origin)

    def test_local_career_markdown_endpoint_returns_the_original_utf8_files(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, "001.md").write_text(
                "# Posting\n"
                "- **회사명:** 예시 회사\n"
                "- **공고명:** 예시 직무 채용\n"
                "- **직무명:** 예시 직무\n"
                "- **근무지:** 서울\n"
                "- **고용형태:** 정규직\n"
                "- **경력:** 신입\n"
                "- **직무 소개:** 한글 직무 소개\n"
                "### 3. 담당업무\n- 업무 설명\n"
                "### 4. 자격요건\n- 자격 설명\n"
                "### 5. 우대사항\n- 우대 설명\n",
                encoding="utf-8",
            )
            Path(directory, "002.md").write_text(
                "- **회사명:** 다른 회사\n"
                "- **공고명:** 예시 직무 채용 2\n"
                "- **직무명:** 예시 직무\n",
                encoding="utf-8",
            )
            with patch.dict(
                os.environ, {"CAREERLENS_JOB_POSTINGS_DIR": directory}, clear=True
            ):
                response = self.app().test_client().get("/api/v1/local-data/career-markdown")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json["items"]), 2)
        self.assertEqual(response.json["items"][0]["id"], "001")
        self.assertEqual(response.json["items"][0]["filename"], "001.md")
        self.assertIn("- **직무명:** 예시 직무", response.json["items"][0]["content"])
        self.assertIn("### 5. 우대사항", response.json["items"][0]["content"])
        self.assertNotIn("roles", response.json)

    def test_local_career_markdown_reports_missing_source(self):
        with tempfile.TemporaryDirectory() as directory:
            missing = Path(directory, "missing")
            with patch.dict(
                os.environ, {"CAREERLENS_JOB_POSTINGS_DIR": str(missing)}, clear=True
            ):
                response = self.app().test_client().get("/api/v1/local-data/career-markdown")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json["error"]["code"], "career_markdown_unavailable")

    def test_origin_validation(self):
        for value in (
            "http://localhost:5101",
            "http://127.0.0.1:5101/",
            "http://[::1]:5101",
            "https://api.example.com",
            "https://127.0.0.1:8443",
        ):
            with self.subTest(value=value):
                self.assertTrue(server.validate_origin(value))
        for value in (
            "http://api.example.com",
            "ftp://localhost",
            "https://user:password@api.example.com",
            "https://api.example.com/api/v1",
            "https://api.example.com?key=value",
            "https://api.example.com/#secret",
            "https://api.example.com:0",
            "https://api.example.com:99999",
            "https://bad\\host",
            "https://bad%20host",
            "https://bad_host",
            "https://api.example.com\n",
            "//api.example.com",
            "https://",
        ):
            with self.subTest(value=value), self.assertRaises(ValueError):
                server.validate_origin(value)

    def test_unconfigured_and_unavailable_apis_are_errors(self):
        app = self.app()
        with app.test_client() as client:
            with client.get("/") as index:
                self.assertEqual(index.status_code, 200)
            self.assertFalse(client.get("/health").json["backend_configured"])
            response = client.get("/api/v1/auth/session")
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.json["error"]["code"], "backend_unconfigured")
        app = self.app("https://api.example.com", Opener(error=URLError("offline")))
        response = app.test_client().get("/api/v1/auth/session")
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json["error"]["code"], "backend_unavailable")

    def test_proxy_keeps_csrf_origin_cookie_and_uses_api_host(self):
        opener = Opener()
        with self.app("https://api.example.com", opener).test_client() as client:
            client.set_cookie("careerlens_session", "test-session")
            response = client.post(
                "/api/v1/auth/login?case=1",
                json={"email": "student@example.com"},
                headers={
                    "Origin": "http://localhost",
                    "X-CSRF-Token": "test-csrf",
                    "Authorization": "Bearer test-token",
                },
            )
        self.assertEqual(response.status_code, 200)
        request, timeout = opener.calls[0]
        headers = {key.lower(): value for key, value in request.header_items()}
        self.assertEqual(request.full_url, "https://api.example.com/api/v1/auth/login?case=1")
        self.assertEqual(request.host, "api.example.com")
        self.assertNotIn("host", headers)
        self.assertEqual(headers["origin"], "http://localhost")
        self.assertEqual(headers["x-csrf-token"], "test-csrf")
        self.assertEqual(headers["authorization"], "Bearer test-token")
        self.assertIn("careerlens_session=test-session", headers["cookie"])
        self.assertEqual(json.loads(request.data), {"email": "student@example.com"})
        self.assertEqual(timeout, 60)

    def test_cookie_domain_removed_security_attributes_and_multiple_headers_preserved(self):
        upstream = UpstreamResponse(
            headers=[
                (
                    "Set-Cookie",
                    "session=one; Domain=api.example.com; Path=/; Secure; HttpOnly; SameSite=Lax",
                ),
                ("Set-Cookie", "state=two; DOMAIN=.example.com; Path=/api; Secure; SameSite=None"),
            ]
        )
        response = (
            self.app("https://api.example.com", Opener(upstream))
            .test_client()
            .get("/api/v1/auth/session")
        )
        cookies = response.headers.getlist("Set-Cookie")
        self.assertEqual(len(cookies), 2)
        self.assertEqual(cookies[0], "session=one; Path=/; Secure; HttpOnly; SameSite=Lax")
        self.assertEqual(cookies[1], "state=two; Path=/api; Secure; SameSite=None")

    def test_api_redirects_stay_local_and_oauth_provider_redirect_is_not_followed(self):
        for destination, expected in (
            (
                "https://api.example.com/api/v1/auth/callback?code=test",
                "/api/v1/auth/callback?code=test",
            ),
            ("https://api.example.com:443/?auth_error=test", "/?auth_error=test"),
            ("/?reset_token=test", "/?reset_token=test"),
            (
                "https://accounts.google.com/o/oauth2/auth?state=test",
                "https://accounts.google.com/o/oauth2/auth?state=test",
            ),
            ("https://api.example.com.evil.test/", "https://api.example.com.evil.test/"),
        ):
            with self.subTest(destination=destination):
                opener = Opener(UpstreamResponse(302, [("Location", destination)]))
                response = (
                    self.app("https://api.example.com", opener)
                    .test_client()
                    .get("/api/v1/auth/oauth/google")
                )
                self.assertEqual(response.status_code, 302)
                self.assertEqual(response.headers["Location"], expected)
                self.assertEqual(len(opener.calls), 1)
        self.assertIsNone(
            server.NoRedirect().redirect_request(
                None, None, 302, "", {}, "https://accounts.google.com"
            )
        )

    def test_env_file_is_not_executed_and_external_environment_wins(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text(
                '# team settings\nBACKEND_URL="https://api.example.com"\nFRONTEND_PORT=5100\nLITERAL=$(not-a-command)\n',
                encoding="utf-8",
            )
            with patch.dict(os.environ, {"BACKEND_URL": "http://127.0.0.1:7777"}, clear=True):
                server.load_local_env(path)
                self.assertEqual(os.environ["BACKEND_URL"], "http://127.0.0.1:7777")
                self.assertEqual(os.environ["FRONTEND_PORT"], "5100")
                self.assertEqual(os.environ["LITERAL"], "$(not-a-command)")

    def test_explicit_argument_overrides_environment_and_static_files_do_not_expose_env(self):
        opener = Opener()
        with (
            patch.dict(os.environ, {"BACKEND_URL": "https://ignored.example.com"}, clear=True),
            patch("server.build_opener", return_value=opener),
        ):
            app = server.create_app("http://127.0.0.1:7777")
        client = app.test_client()
        client.get("/api/v1/auth/session")
        self.assertTrue(opener.calls[0][0].full_url.startswith("http://127.0.0.1:7777/"))
        self.assertEqual(client.get("/.env").status_code, 404)
        self.assertEqual(client.get("/src/.env").status_code, 404)
        with client.get("/favicon.svg") as favicon:
            self.assertEqual(favicon.status_code, 200)

    def test_matching_bundle_is_local_and_works_with_existing_csp(self):
        with self.app().test_client() as client:
            with client.get("/src/features/analysis/matching-eye.js") as response:
                self.assertEqual(response.status_code, 200)
                self.assertIn(response.mimetype, {"text/javascript", "application/javascript"})
                self.assertIn(b"mountMatchingEye", response.data)
                policy = response.headers["Content-Security-Policy"]
                self.assertIn("script-src 'self'", policy)
                self.assertIn("style-src 'self' 'unsafe-inline'", policy)
                self.assertNotIn("'unsafe-eval'", policy)
                self.assertNotIn("https://", policy)

    def test_status_radar_modules_are_served_as_local_javascript(self):
        with self.app().test_client() as client:
            for name in ("status-radar.js", "status-radar-data.js"):
                with self.subTest(module=name):
                    with client.get("/src/features/analysis/" + name) as response:
                        self.assertEqual(response.status_code, 200)
                        self.assertIn(
                            response.mimetype, {"text/javascript", "application/javascript"}
                        )
                        self.assertIn(
                            "script-src 'self'", response.headers["Content-Security-Policy"]
                        )

    def test_design_lab_and_its_local_assets_work_without_contacting_the_configured_api(self):
        opener = Opener(error=AssertionError("The design lab must not contact an upstream API"))
        with self.app("https://api.example.com", opener).test_client() as client:
            with client.get("/") as index:
                expected_policy = index.headers["Content-Security-Policy"]
            for path in (
                "/design-lab",
                "/design-lab?theme=cobalt&layout=studio&eye=glacier&pyramid=ice&effect=comet",
                "/design-lab?theme=%3Cscript%3Ealert(1)%3C%2Fscript%3E&backend=https://invalid.test",
            ):
                with self.subTest(path=path), client.get(path) as response:
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.mimetype, "text/html")
                    self.assertEqual(
                        response.data, (server.ROOT / "public" / "design-lab.html").read_bytes()
                    )
                    self.assertIn(b'/src/features/design-lab/index.js', response.data)
                    self.assertNotIn(b'/src/app/main.js', response.data)
                    self.assertNotIn(b"<script>alert(1)</script>", response.data)
                    self.assertEqual(response.headers["Content-Security-Policy"], expected_policy)
                    self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
                    self.assertEqual(response.headers["X-Frame-Options"], "DENY")
                    self.assertEqual(response.headers["Cache-Control"], "no-store")
            for name in ("index.js", "presets.js", "preview.js", "transition.js", "lab.css", "preview.css"):
                with self.subTest(asset=name):
                    with client.get("/src/features/design-lab/" + name) as response:
                        self.assertEqual(response.status_code, 200)
                        expected_types = (
                            {"text/javascript", "application/javascript"}
                            if name.endswith(".js")
                            else {"text/css"}
                        )
                        self.assertIn(response.mimetype, expected_types)
                        self.assertEqual(
                            response.headers["Content-Security-Policy"], expected_policy
                        )
                        self.assertNotIn("'unsafe-eval'", expected_policy)
                        self.assertNotIn("https://", expected_policy)
        self.assertEqual(opener.calls, [])

    def test_design_lab_does_not_make_environment_or_parent_paths_public(self):
        with self.app().test_client() as client:
            for path in (
                "/.env",
                "/design-lab/.env",
                "/design-lab/../.env",
                "/src/../.env",
                "/src/features/design-lab/../../../.env",
                "/src/features/design-lab/%2E%2E/%2E%2E/%2E%2E/.env",
                "/public/../.env",
                "/public/design-lab.html",
            ):
                with self.subTest(path=path), client.get(path) as response:
                    self.assertEqual(response.status_code, 404)
                    self.assertIn("script-src 'self'", response.headers["Content-Security-Policy"])


if __name__ == "__main__":
    unittest.main()
