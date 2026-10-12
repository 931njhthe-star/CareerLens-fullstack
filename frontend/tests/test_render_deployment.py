"""Render-like standalone frontend checks, without a live backend or credentials."""

import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import server
from test_server import Opener, UpstreamResponse


class RenderDeploymentTests(unittest.TestCase):
    def setUp(self):
        environment = patch.dict(
            os.environ,
            {
                "RENDER": "true",
                "RENDER_EXTERNAL_URL": "https://careerlens-test.onrender.com",
                "BACKEND_URL": "https://api.example.test",
            },
            clear=True,
        )
        environment.start()
        self.addCleanup(environment.stop)

    def test_render_and_custom_hosts_are_allowed_without_trusting_arbitrary_hosts(self):
        with patch.dict(os.environ, {"FRONTEND_PUBLIC_ORIGIN": "https://career.example.test"}):
            client = server.create_app().test_client()
        for host in ("careerlens-test.onrender.com", "career.example.test", "localhost"):
            with self.subTest(host=host):
                response = client.get("/health", base_url="https://" + host)
                self.assertEqual(response.status_code, 200)
                self.assertTrue(response.json["backend_configured"])
        self.assertEqual(client.get("/health", base_url="https://other.onrender.com").status_code, 400)

    def test_render_rejects_backend_addresses_that_only_work_on_the_developer_pc(self):
        for origin in ("http://127.0.0.1:5301", "https://127.0.0.2", "https://localhost", "https://[::1]"):
            with self.subTest(origin=origin), self.assertRaises(ValueError):
                server.create_app(origin)

    def test_local_development_keeps_loopback_support(self):
        with patch.dict(os.environ, {"RENDER": ""}):
            client = server.create_app("http://127.0.0.1:5301").test_client()
        self.assertEqual(client.get("/health").status_code, 200)

    def test_frontend_only_checkout_serves_pages_motion_and_catalog(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "frontend"
            root.mkdir()
            for directory in ("public", "src", "data"):
                shutil.copytree(server.ROOT / directory, root / directory)
            with patch("server.ROOT", root):
                client = server.create_app("").test_client()
                for path in (
                    "/", "/design-lab", "/motion-preview", "/favicon.svg",
                    "/src/app/main.js", "/src/shared/styles/my-page.css",
                    "/src/features/analysis/pupil-motion.js",
                    "/src/features/analysis/wordmark-motion.js",
                    "/src/features/analysis/status-radar.js",
                    "/src/features/analysis/matching-eye.js",
                ):
                    with self.subTest(path=path), client.get(path) as response:
                        self.assertEqual(response.status_code, 200)
                catalog = client.get("/api/v1/local-data/career-markdown")
                self.assertEqual(catalog.status_code, 200)
                self.assertGreater(len(catalog.json["items"]), 0)
                self.assertTrue(all(item.get("role_category") for item in catalog.json["items"]))
                self.assertFalse(client.get("/health").json["backend_configured"])
                self.assertEqual(client.get("/api/v1/me").status_code, 503)
                for path in ("/.env", "/render.yaml", "/data/career-postings.json", "/server.py"):
                    self.assertEqual(client.get(path).status_code, 404)

    def test_configured_source_takes_precedence_and_misconfiguration_is_not_hidden(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "001.md").write_text("# Updated fictional source", encoding="utf-8")
            with patch.dict(os.environ, {"CAREERLENS_JOB_POSTINGS_DIR": folder}):
                client = server.create_app().test_client()
                response = client.get("/api/v1/local-data/career-markdown")
                self.assertEqual(response.json["items"][0]["content"], "# Updated fictional source")
                self.assertEqual(len(response.json["items"]), 1)
            with patch.dict(os.environ, {"CAREERLENS_JOB_POSTINGS_DIR": str(root / "missing")}):
                response = client.get("/api/v1/local-data/career-markdown")
                self.assertEqual(response.status_code, 503)
                self.assertNotIn(folder, response.get_data(as_text=True))

    def test_packaged_catalog_contains_only_numbered_posting_fields(self):
        snapshot = server.ROOT / "data" / "career-postings.json"
        self.assertLess(snapshot.stat().st_size, 10 * 1024 * 1024)
        items = json.loads(snapshot.read_text(encoding="utf-8"))["items"]
        self.assertGreater(len(items), 0)
        self.assertEqual(len({item["id"] for item in items}), len(items))
        for item in items:
            self.assertRegex(item["id"], r"^[0-9]+$")
            self.assertEqual(item["filename"], item["id"] + ".md")
            self.assertEqual(set(item), {"id", "filename", "content", "role_category"})

    def test_public_host_proxy_preserves_auth_and_returns_real_upstream_errors(self):
        opener = Opener(UpstreamResponse(401, body=b'{"error":{"code":"unauthorized"}}'))
        with patch("server.build_opener", return_value=opener):
            client = server.create_app().test_client()
        response = client.get(
            "/api/v1/me", base_url="https://careerlens-test.onrender.com",
            headers={"Authorization": "Bearer synthetic-test-token"},
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json["error"]["code"], "unauthorized")
        request = opener.calls[0][0]
        self.assertEqual(request.full_url, "https://api.example.test/api/v1/me")
        self.assertEqual(request.get_header("Authorization"), "Bearer synthetic-test-token")


if __name__ == "__main__":
    unittest.main()
