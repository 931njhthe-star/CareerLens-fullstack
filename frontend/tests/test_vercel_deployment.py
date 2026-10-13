import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from flask import Flask
import server


class VercelDeploymentTests(unittest.TestCase):
    def setUp(self):
        environment = patch.dict(os.environ, {
            'VERCEL': '1',
            'VERCEL_URL': 'career-preview.vercel.app',
            'VERCEL_PROJECT_PRODUCTION_URL': 'career-live.vercel.app',
            'BACKEND_URL': 'https://api.example.test',
        }, clear=True)
        environment.start()
        self.addCleanup(environment.stop)

    def test_module_exports_wsgi_app(self):
        self.assertIsInstance(server.app, Flask)

    def test_preview_and_production_hosts_serve_latest_assets(self):
        client = server.create_app().test_client()
        for host in ('career-preview.vercel.app', 'career-live.vercel.app'):
            base = 'https://' + host
            self.assertEqual(client.get('/', base_url=base).status_code, 200)
            self.assertTrue(client.get('/health', base_url=base).json['backend_configured'])
            self.assertEqual(client.get('/src/app/main.js', base_url=base).status_code, 200)
            catalog = client.get('/api/v1/local-data/career-markdown', base_url=base)
            self.assertEqual(catalog.status_code, 200)
            self.assertEqual(len(catalog.json['items']), 100)
        self.assertEqual(client.get('/health', base_url='https://other.vercel.app').status_code, 400)

    def test_temporary_store_is_outside_deployment_source(self):
        app = server.create_app()
        self.assertEqual(app.extensions['guest_analysis'].path,
                         Path(tempfile.gettempdir()) / 'careerlens-frontend' / 'guest-reports.sqlite3')

    def test_backend_requires_remote_https(self):
        for origin in ('http://localhost:5301', 'https://localhost', 'https://127.0.0.1'):
            with self.subTest(origin=origin), self.assertRaises(ValueError):
                server.create_app(origin)
