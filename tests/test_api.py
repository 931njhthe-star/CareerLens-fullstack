import asyncio
import threading
from uuid import uuid4
from types import SimpleNamespace
import pytest
from pydantic import SecretStr
from fastapi.testclient import TestClient
import app.main as main_module
from app.main import app
from app.api.v1.routes.api import user


@pytest.fixture(autouse=True)
def prevent_background_worker_from_polling(monkeypatch):
    class TestDB:
        async def open(self): pass
        async def health(self): return True
        async def close(self): pass

    class TestLLM:
        async def close(self): pass

    config = SimpleNamespace(
        auth_enabled=True,
        jwt_secret_key=SecretStr('test-only-secret-' + 'x' * 40),
        jwt_issuer='careerlens-test',
        cors_origins='http://localhost:3000',
        access_token_seconds=900,
        refresh_token_days=30,
        admin_user_ids='',
        upload_max_bytes=10 * 1024 * 1024,
        max_document_tokens=20000,
    )
    monkeypatch.setattr(main_module, 'settings', lambda: config)
    monkeypatch.setattr(main_module, 'DB', lambda _config: TestDB())
    monkeypatch.setattr(main_module, 'LLM', lambda _config: TestLLM())

    async def idle_worker(*_args):
        await asyncio.Event().wait()

    monkeypatch.setattr(main_module, 'run_worker', idle_worker)


def test_health_and_auth_required():
    with TestClient(app) as client:
        assert client.get('/health').status_code == 200
        assert client.get('/api/v1/resumes').status_code == 401
        assert client.get('/api/v1/jobs').status_code == 401


def test_lifespan_starts_and_stops_evaluation_worker(monkeypatch):
    started = threading.Event()
    stopped = threading.Event()

    async def worker(*_args):
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            stopped.set()

    monkeypatch.setattr(main_module, 'run_worker', worker)
    with TestClient(app):
        assert started.wait(timeout=2)
    assert stopped.wait(timeout=2)


def test_uvicorn_uses_selector_loop_factory_on_windows():
    import sys
    import uvicorn

    if sys.platform != 'win32':
        pytest.skip('The selector loop requirement applies to Windows')

    config = uvicorn.Config('app.main:app', loop='app.core.asyncio:uvicorn_loop_factory')
    loop = config.get_loop_factory()()
    try:
        assert isinstance(loop, asyncio.SelectorEventLoop)
    finally:
        loop.close()


def test_markdown_upload_validation():
    app.dependency_overrides[user] = lambda: str(uuid4())
    try:
        with TestClient(app) as client:
            assert client.post('/api/v1/resumes', files={'file':('resume.pdf',b'text','application/pdf')}).status_code == 415
            assert client.post('/api/v1/resumes', files={'file':('resume.md',b'\xff','text/markdown')}).status_code == 422
            assert client.post('/api/v1/resumes', files={'file':('resume.md',b'','text/markdown')}).status_code == 422
    finally: app.dependency_overrides.clear()


def test_cross_user_resume_is_hidden():
    class FakeDB:
        async def select(self, table, **params):
            assert 'user_id' in params
            return []
        async def close(self): pass
    app.dependency_overrides[user] = lambda: str(uuid4())
    try:
        with TestClient(app) as client:
            app.state.db = FakeDB()
            assert client.get('/api/v1/resumes/' + str(uuid4())).status_code == 404
    finally: app.dependency_overrides.clear()


def test_jobs_expose_markdown_source_identifiers_for_frontend_matching():
    class FakeDB:
        async def select(self, table, **params):
            assert table == 'job_postings'
            assert 'source_name' in params['select']
            assert 'source_external_id' in params['select']
            return [{
                'id': str(uuid4()),
                'company_id': str(uuid4()),
                'title': '예시 공고',
                'source_name': 'local_markdown',
                'source_external_id': '001.md',
            }]

    app.dependency_overrides[user] = lambda: str(uuid4())
    try:
        with TestClient(app) as client:
            original_db = app.state.db
            try:
                app.state.db = FakeDB()
                response = client.get('/api/v1/jobs')
            finally:
                app.state.db = original_db
        assert response.status_code == 200
        assert response.json()[0]['source_external_id'] == '001.md'
    finally:
        app.dependency_overrides.clear()


def test_evaluation_progress_returns_owned_run_and_events_after_cursor():
    uid = str(uuid4())
    run_id = str(uuid4())
    event = {
        'id': 12,
        'run_id': run_id,
        'stage': 'criterion',
        'status': 'completed',
        'message': 'A1 · 근거 검토 완료',
        'progress_percent': 42,
    }

    class FakeDB:
        async def select(self, table, **params):
            if table == 'evaluation_runs':
                assert params == {'id': f'eq.{run_id}', 'user_id': f'eq.{uid}', 'limit': 1}
                return [{
                    'id': run_id,
                    'status': 'running',
                    'current_stage': 'criterion',
                    'progress_percent': 42,
                }]
            assert table == 'progress_events'
            assert params['run_id'] == f'eq.{run_id}'
            assert params['id'] == 'gt.10'
            assert params['order'] == 'id.asc'
            assert params['limit'] == 100
            return [event]

    app.dependency_overrides[user] = lambda: uid
    try:
        with TestClient(app) as client:
            original_db = app.state.db
            try:
                app.state.db = FakeDB()
                response = client.get(f'/api/v1/evaluations/{run_id}/progress?after_id=10')
            finally:
                app.state.db = original_db
        assert response.status_code == 200
        assert response.json()['run']['progress_percent'] == 42
        assert response.json()['events'] == [event]
    finally:
        app.dependency_overrides.clear()
