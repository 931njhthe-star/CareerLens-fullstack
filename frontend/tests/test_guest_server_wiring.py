"""Guest bridge integration boundaries; no model, credentials, or live API calls."""
import json
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from werkzeug.exceptions import NotFound, Unauthorized
import server


class Response:
    code = 200

    def __init__(self, body):
        self.body = body

    def read(self):
        return json.dumps(self.body).encode()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass


class Opener:
    def __init__(self, body):
        self.body, self.calls = body, []

    def open(self, req, timeout):
        self.calls.append((req, timeout))
        if isinstance(self.body, Exception):
            raise self.body
        return Response(self.body)


class GuestServerWiringTests(unittest.TestCase):
    def app(self, opener):
        with patch("server.build_opener", return_value=opener):
            return server.create_app("http://127.0.0.1:5301")

    def test_only_backend_verified_profile_can_own_a_report(self):
        owner = "cedf8036-cdda-46c1-b797-c00939e41bdc"
        opener = Opener({"user_id": owner})
        app = self.app(opener)
        verify = app.extensions["guest_analysis"].verify_user
        self.assertEqual(verify("Bearer verified-fixture"), owner)
        req, timeout = opener.calls[0]
        self.assertEqual(req.full_url, "http://127.0.0.1:5301/api/v1/me")
        self.assertEqual(req.get_header("Authorization"), "Bearer verified-fixture")
        self.assertEqual(timeout, 15)
        for body in ({"user_id": "not-a-uuid"}, {"id": owner}, {},
                     HTTPError(req.full_url, 401, "PRIVATE", {}, None)):
            verify = self.app(Opener(body)).extensions["guest_analysis"].verify_user
            with self.assertRaises(Unauthorized):
                verify("Bearer invalid-fixture")

    def test_capability_probe_creates_only_cookie_and_never_calls_backend(self):
        opener = Opener({})
        app = self.app(opener)
        with patch("server.engine_available", return_value=True):
            response = app.test_client().get("/api/v1/local-guest/capabilities")
        self.assertTrue(response.json["available"])
        self.assertIn("HttpOnly", response.headers["Set-Cookie"])
        self.assertEqual(opener.calls, [])
        self.assertFalse(app.extensions["guest_analysis"]._initialized)

    def test_job_body_is_resolved_from_server_catalog_and_not_user_paths(self):
        catalog = {"items": [{"id": "005", "content":
            "## 005. 역할\n- **회사명:** 가상 기업\n- **직무명:** AI 기획자\n"}]}
        with patch("server.load_career_catalog", return_value=catalog):
            result = server.guest_catalog_job("backup-005")
            self.assertEqual(result["description"], catalog["items"][0]["content"])
            self.assertEqual(result["title"], "AI 기획자")
            self.assertEqual(result["company_name"], "가상 기업")
            self.assertTrue(result["is_fictional"])
            for value in ("../../.env", "backup-999", "https://attacker.invalid", "anything"):
                with self.assertRaises(NotFound):
                    server.guest_catalog_job(value)


if __name__ == "__main__":
    unittest.main()
