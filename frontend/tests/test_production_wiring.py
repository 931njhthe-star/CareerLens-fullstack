"""Deployment boundaries without real keys, models, databases or cloud resources."""
import os
from pathlib import Path
import subprocess
import sys
from unittest.mock import patch

import pytest
import server


def test_frontend_server_imports_as_backend_package():
    root = Path(__file__).resolve().parents[2]
    subprocess.run(
        [sys.executable, "-c", "from app.main import app; assert app"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    )


def test_member_dashboard_path_reaches_frontend_mount_in_integrated_backend():
    root = Path(__file__).resolve().parents[2]
    subprocess.run(
        [
            sys.executable,
            "-c",
            "from fastapi.testclient import TestClient; from app.main import app; "
            "response = TestClient(app, base_url='http://127.0.0.1').get("
            "'/api/v1/member/evaluation-performance'); "
            "assert response.status_code == 401, response.status_code",
        ],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    )


def test_integrated_frontend_exposes_session_contract_fallback_only():
    integrated = server.create_app(backend_url="", integrated=True).test_client()
    standalone = server.create_app(backend_url="").test_client()

    assert integrated.get("/api/v1/auth/session").status_code == 404
    assert integrated.get("/api/v1/me").status_code == 503
    assert standalone.get("/api/v1/auth/session").status_code == 503


def test_private_docker_api_requires_operator_allowlist():
    with patch.dict(os.environ, {"BACKEND_URL": "http://api:5301"}, clear=True):
        with pytest.raises(ValueError):
            server.create_app()
        with patch.dict(os.environ, {"CAREERLENS_INTERNAL_API_HOST": "api"}):
            app = server.create_app()
            assert app.test_client().get('/health').json['backend_configured']
            with pytest.raises(ValueError):
                server.create_app('http://untrusted:5301')


def test_tls_proxy_secure_cookie_and_durable_guest_path(tmp_path):
    path = tmp_path / 'persistent' / 'reports.sqlite3'
    values = {"BACKEND_URL": "http://api:5301", "CAREERLENS_INTERNAL_API_HOST": "api",
              "FRONTEND_PUBLIC_ORIGIN": "https://career.example.test", "CAREERLENS_TRUST_PROXY": "1",
              "CAREERLENS_GUEST_STORE_PATH": str(path)}
    with patch.dict(os.environ, values, clear=True), patch('server.engine_available', return_value=True):
        app = server.create_app()
        assert app.extensions['guest_analysis'].path == path
        client = app.test_client()
        response = client.get('/api/v1/local-guest/capabilities', base_url='http://career.example.test',
                              headers={'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '192.0.2.40'})
        assert response.status_code == 200
        assert 'Secure;' in response.headers['Set-Cookie']
        assert 'HttpOnly;' in response.headers['Set-Cookie']
        assert client.get('/health', base_url='https://attacker.example.test').status_code == 400
        assert not path.exists()  # A capability probe does not initialize/delete stored runs.


def test_default_local_server_does_not_trust_forwarded_proto():
    with patch.dict(os.environ, {}, clear=True):
        app = server.create_app('http://127.0.0.1:5301')
        response = app.test_client().get('/api/v1/local-guest/capabilities', headers={'X-Forwarded-Proto': 'https'})
        assert 'Secure;' not in response.headers['Set-Cookie']


def test_full_deployment_has_private_services_and_persistent_storage():
    import yaml
    folder = Path(__file__).parents[1] / 'infra' / 'deploy'
    config = yaml.safe_load((folder / 'compose.yaml').read_text(encoding='utf-8'))
    services = config['services']
    assert set(services) == {'frontend', 'api', 'worker', 'gateway'}
    for name in ('frontend', 'api', 'worker'):
        assert 'ports' not in services[name]
        assert services[name]['restart'] == 'unless-stopped'
    for name in ('frontend', 'api', 'worker'):
        assert services[name]['environment']['APP_ENV'] == 'production'
        assert 'CAREERLENS_FLOW_REDIS_URL' not in services[name]['environment']
    assert services['frontend']['volumes'] == ['guest-data:/var/lib/careerlens/guest']
    assert (folder / services['frontend']['build']['context']).resolve() == Path(__file__).resolve().parents[2]
    dockerfile = (folder / 'Dockerfile').read_text()
    assert 'COPY . ' not in dockerfile
    assert 'USER careerlens' in dockerfile
    assert 'CareerLens-backend/app' in dockerfile
    assert '**/.env*' in (folder / 'Dockerfile.dockerignore').read_text()
