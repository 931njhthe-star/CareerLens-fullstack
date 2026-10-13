"""Synthetic diagnostics must never reach a browser through the frontend proxy."""

from io import BytesIO
import json
import shutil
import subprocess
import unittest
from unittest.mock import patch

import server
import test_server
from test_server import Opener, UpstreamResponse


PRIVATE = "Traceback /srv/private/service.py postgres://user:secret@db sk-test-private-key"


class SafeErrorTests(unittest.TestCase):
    def client(self, status=500, body=None, headers=()):
        if body is None:
            body = json.dumps({"detail": PRIVATE}).encode()
        app = test_server.ServerTests().app("https://api.example.test", Opener(UpstreamResponse(status, headers, body)))
        return app.test_client()

    def assert_safe(self, response, status):
        self.assertEqual(response.status_code, status)
        self.assertEqual(response.mimetype, "application/json")
        self.assertEqual(set(response.json), {"error"})
        self.assertEqual(set(response.json["error"]), {"code", "message"})
        self.assertNotRegex(response.get_data(as_text=True), r"Traceback|private|postgres|secret|sk-test")

    def test_json_html_plain_text_and_validation_details_are_sanitized_with_original_status(self):
        bodies = [
            json.dumps({"error": PRIVATE}).encode(),
            json.dumps({"error": {"code": PRIVATE, "message": PRIVATE}}).encode(),
            json.dumps({"detail": [{"msg": PRIVATE, "input": PRIVATE}]}).encode(),
            ("<html>" + PRIVATE + "</html>").encode(), PRIVATE.encode(), b"null", b"[]",
        ]
        for status in (400, 401, 403, 404, 409, 413, 415, 422, 429, 500, 502, 503, 504):
            for body in bodies:
                with self.subTest(status=status, body=body[:15]):
                    response = self.client(status, body, [("Content-Type", "text/html")]).get("/api/v1/me")
                    self.assert_safe(response, status)

    def test_safe_contract_preserves_guest_expiry_refresh_and_retry_recovery(self):
        self.assertEqual(self.client(401).get("/api/v1/me").json["error"]["code"], "unauthorized")
        response = self.client(410, json.dumps({"error": {"code": "guest_missing", "message": PRIVATE}}).encode()).get("/api/v1/guest/workspace")
        self.assertEqual(response.json["error"]["code"], "guest_missing")
        response = self.client(429, headers=[("Retry-After", "60")]).get("/api/v1/me")
        self.assertEqual(response.headers["Retry-After"], "60")
        self.assertEqual(response.json["error"]["code"], "rate_limited")

    def test_auth_errors_do_not_disclose_account_existence(self):
        messages = set()
        for path, status in (("login", 401), ("signup", 409), ("register", 400)):
            response = self.client(status).post("/api/v1/auth/" + path)
            self.assert_safe(response, status)
            messages.add(response.json["error"]["message"])
        self.assertEqual(len(messages), 1)

    def test_local_misconfiguration_and_unexpected_parser_exceptions_stay_private(self):
        client = test_server.ServerTests().app().test_client()
        response = client.get("/api/v1/me")
        self.assertNotRegex(response.json["error"]["message"], r"BACKEND|\.env|설정|실행")
        with patch("server.extract_resume", side_effect=ValueError(PRIVATE)):
            response = client.post("/api/v1/local-data/convert-resume", data={"file": (BytesIO(b"fixture"), "resume.md")})
        self.assert_safe(response, 400)
        with patch("server.extract_resume", side_effect=RuntimeError(PRIVATE)):
            response = client.post("/api/v1/local-data/convert-resume", data={"file": (BytesIO(b"fixture"), "resume.md")})
        self.assert_safe(response, 500)

    def test_trusted_local_validation_still_explains_empty_files(self):
        response = test_server.ServerTests().app().test_client().post("/api/v1/local-data/convert-resume", data={"file": (BytesIO(b""), "resume.md")})
        self.assertEqual(response.status_code, 400)
        self.assertIn("파일이 비어", response.json["error"]["message"])

    def test_successful_polling_preserves_progress_but_drops_event_diagnostics(self):
        run = {"id": "fixture-run", "status": "failed", "progress_percent": 35.5, "current_stage": "evaluating", "failure_reason": PRIVATE}
        data = {"run": run, "events": [{"id": 13, "status": "failed", "message": PRIVATE, "detail": PRIVATE, "payload": {"stack": PRIVATE}}]}
        response = self.client(200, json.dumps(data).encode()).get("/api/v1/evaluations/fixture-run/progress")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["run"]["progress_percent"], 35.5)
        self.assertEqual(response.json["events"], [{"id": 13, "status": "failed"}])
        self.assertNotIn(PRIVATE, response.get_data(as_text=True))
        response = self.client(200, json.dumps(run).encode()).get("/api/v1/evaluations/fixture-run")
        self.assertEqual(response.json["id"], "fixture-run")
        self.assertNotIn(PRIVATE, response.get_data(as_text=True))

    def test_sse_progress_done_and_malformed_frames_never_forward_diagnostics(self):
        body = (": " + PRIVATE + "\n\n"
            + 'id: 13\nevent: progress\ndata: ' + json.dumps({"id": 13, "progress_percent": 23.5, "message": PRIVATE}) + "\n\n"
            + 'event: done\ndata: ' + json.dumps({"status": "failed", "failure_reason": PRIVATE}) + "\n\n"
            + 'event: error\ndata: ' + PRIVATE + "\n\n"
            + 'event: progress\ndata: ' + PRIVATE + "\n\n").encode()
        response = self.client(200, body, [("Content-Type", "text/event-stream")]).get("/api/v1/evaluations/fixture-run/events")
        self.assertEqual(response.status_code, 200)
        text = response.get_data(as_text=True)
        self.assertNotIn(PRIVATE, text)
        self.assertIn('id: 13\nevent: progress', text)
        self.assertIn('"progress_percent": 23.5', text)
        self.assertIn('event: done', text)
        self.assertIn('event: error', text)

    def test_worker_milestones_survive_real_proxy_and_browser_flow_contract(self):
        milestones = [
            ("parsing", "이력서 문서 구조화 시작", "running"),
            ("parsing", "이력서 문서 구조화 완료", "running"),
            ("parsing", "채용공고 구조화 완료", "running"),
            ("indexing", "이력서 근거 검색 준비 완료", "running"),
            ("validation", "전체 평가 결과 교차 검토 완료", "completed"),
            ("validation", "최종 점수 계산 완료", "completed"),
            ("validation", "최종 Markdown 보고서 저장 완료", "completed"),
        ] + [("criterion", f"{domain}{number} · 12/12개 항목 검증 및 저장 완료", "completed")
             for domain in "ABCD" for number in range(1, 4)]
        events = [{"id": index, "stage": stage, "message": message, "status": status,
                   "progress_percent": 70, "payload": PRIVATE, "failure_reason": PRIVATE}
                  for index, (stage, message, status) in enumerate(milestones, 1)]
        data = {"run": {"id": "fixture-run", "status": "running"}, "events": events}
        response = self.client(200, json.dumps(data).encode()).get("/api/v1/evaluations/fixture-run/progress")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json["events"]), len(milestones))
        self.assertNotIn(PRIVATE, response.get_data(as_text=True))
        # Exercise the exact wire JSON with the production browser sanitizer.
        node = shutil.which("node")
        if node is None:
            self.fail("Node is required for the proxy/browser progress contract test")
        script = """
import { sanitizeFlowProgressEvents } from './src/features/activity-flow/backend-progress.js';
let input = '';
for await (const chunk of process.stdin) input += chunk;
process.stdout.write(JSON.stringify(sanitizeFlowProgressEvents(JSON.parse(input).events)));
"""
        result = subprocess.run([node, "--input-type=module", "-e", script], cwd=server.ROOT,
                                input=json.dumps(response.json), text=True, encoding="utf-8",
                                capture_output=True, check=True, timeout=10)
        mapped = json.loads(result.stdout)
        self.assertEqual(len(mapped), len(milestones))
        self.assertEqual([item["node"] for item in mapped[:7]],
                         ["parse_resume", "parse_resume", "parse_job", "indexing", "validation", "scoring", "database"])
        self.assertEqual([item["criterion"] for item in mapped[7:]],
                         [f"{domain}{number}" for domain in "ABCD" for number in range(1, 4)])
        self.assertNotRegex(result.stdout, r"message|payload|failure_reason|private")

    def test_milestone_allowlist_rejects_private_or_malformed_variants(self):
        cases = [
            {"stage": "parsing", "message": "이력서 문서 구조화 시작 " + PRIVATE, "status": "running"},
            {"stage": "parsing", "message": "이력서 문서 구조화 완료", "status": "failed"},
            {"stage": "criterion", "message": "A4 · 평가 시작", "status": "running"},
            {"stage": "criterion", "message": "A1 · 13/12개 항목 검증 및 저장 완료", "status": "completed"},
            {"stage": "validation", "message": "검토 지적 항목 0개 재평가 시작", "status": "running"},
            {"stage": "criterion", "message": [PRIVATE], "status": "running"},
        ]
        for event in cases:
            with self.subTest(event=event):
                self.assertNotIn("message", server.public_evaluation_progress(event))

    def test_sse_keeps_only_known_milestone_without_private_fields(self):
        event = {"id": 12, "stage": "criterion", "message": "B2 · 평가 시작",
                 "status": "running", "payload": PRIVATE}
        body = ("id: 12\nevent: progress\ndata: " + json.dumps(event) + "\n\n").encode()
        response = self.client(200, body, [("Content-Type", "text/event-stream")]).get("/api/v1/evaluations/fixture-run/events")
        self.assertIn("B2 · 평가 시작", response.get_data(as_text=True))
        self.assertNotIn(PRIVATE, response.get_data(as_text=True))

    def test_report_success_content_is_not_rewritten_as_an_error(self):
        data = {"report_text": "# Synthetic report\nOriginal report content", "status": "completed"}
        response = self.client(200, json.dumps(data).encode()).get("/api/v1/reports/fixture")
        self.assertEqual(response.json, data)


if __name__ == "__main__":
    unittest.main()
