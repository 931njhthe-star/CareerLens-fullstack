import asyncio
import threading
from datetime import datetime, timedelta, timezone
from decimal import Decimal
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
        health = client.get('/health')
        assert health.status_code == 200
        assert health.headers['content-type'] == 'application/json; charset=utf-8'
        assert client.get('/healthz').json() == {'status': 'ok'}
        assert client.get('/api/v1/resumes').status_code == 401
        assert client.get('/api/v1/jobs').status_code == 401


def test_render_service_serves_frontend_and_conversion_routes():
    with TestClient(app, base_url='http://localhost') as client:
        page = client.get('/')
        assert page.status_code == 200
        assert 'text/html' in page.headers['content-type']
        assert client.get('/src/app/main.js').status_code == 200
        catalog = client.get('/api/v1/local-data/career-markdown')
        assert catalog.status_code == 200
        assert len(catalog.json()['items']) == 100
        original = '# 이력서\n\nPython과 SQL 경험\n'
        converted = client.post('/api/v1/local-data/convert-resume',
                                files={'file': ('resume.md', original.encode('utf-8'), 'text/markdown')})
        assert converted.status_code == 200
        assert converted.json()['text'].strip() == original.strip()
        for path in ('/.env', '/requirements.txt', '/app/main.py', '/frontend/server.py'):
            assert client.get(path).status_code == 404


def test_frontend_mount_keeps_backend_routes_and_authentication():
    with TestClient(app, base_url='http://localhost') as client:
        assert client.get('/healthz').json() == {'status': 'ok'}
        assert client.get('/health').status_code == 200
        assert client.get('/docs').status_code == 200
        assert client.get('/api/v1/me').status_code == 401
        assert client.get('/api/v1/jobs').status_code == 401
        # The frontend must not proxy an unknown API request back to this service.
        assert client.get('/api/v1/unknown-route').status_code == 404


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


def test_member_dashboard_lists_only_the_authenticated_users_recent_runs():
    uid = str(uuid4())
    recent_id, old_id = str(uuid4()), str(uuid4())
    now = datetime.now(timezone.utc)

    class FakeDB:
        async def select(self, table, **params):
            assert table == 'evaluation_runs'
            assert params == {
                'user_id': f'eq.{uid}',
                'select': 'id,status,created_at,started_at,completed_at',
                'order': 'created_at.desc',
                'limit': 100,
            }
            return [
                {'id': recent_id, 'status': 'completed', 'created_at': now,
                 'original_text': 'must not be returned'},
                {'id': old_id, 'status': 'failed',
                 'created_at': now - timedelta(days=31)},
            ]

    app.dependency_overrides[user] = lambda: uid
    try:
        with TestClient(app) as client:
            original_db = app.state.db
            try:
                app.state.db = FakeDB()
                response = client.get('/api/v1/member/evaluation-performance?days=30&run_limit=100')
            finally:
                app.state.db = original_db
        assert response.status_code == 200
        result = response.json()
        assert result['scope']['mode'] == 'account'
        assert result['summary']['run_count'] == 1
        assert [run['id'] for run in result['runs']] == [recent_id]
        assert 'original_text' not in response.text
    finally:
        app.dependency_overrides.clear()


def test_legacy_local_data_member_dashboard_alias_reads_authenticated_database_records():
    uid, run_id = str(uuid4()), str(uuid4())
    now = datetime.now(timezone.utc)

    class FakeDB:
        async def select(self, table, **params):
            assert table == 'evaluation_runs'
            assert params['user_id'] == f'eq.{uid}'
            return [{'id': run_id, 'status': 'completed', 'created_at': now}]

    app.dependency_overrides[user] = lambda: uid
    try:
        with TestClient(app) as client:
            original_db = app.state.db
            try:
                app.state.db = FakeDB()
                response = client.get('/api/v1/local-data/member-performance')
            finally:
                app.state.db = original_db
        assert response.status_code == 200
        assert response.json()['scope']['mode'] == 'account'
        assert [run['id'] for run in response.json()['runs']] == [run_id]
    finally:
        app.dependency_overrides.clear()


def test_legacy_admin_dashboard_path_returns_only_the_authenticated_members_runs():
    uid, run_id = str(uuid4()), str(uuid4())
    now = datetime.now(timezone.utc)

    class FakeDB:
        async def select(self, table, **params):
            assert table == 'evaluation_runs'
            assert params == {
                'user_id': f'eq.{uid}',
                'select': 'id,status,created_at,started_at,completed_at',
                'order': 'created_at.desc',
                'limit': 100,
            }
            return [{'id': run_id, 'status': 'completed', 'created_at': now}]

        async def rpc(self, *_args, **_kwargs):
            pytest.fail('Member dashboard must not call the administrator aggregate')

    app.dependency_overrides[user] = lambda: uid
    try:
        with TestClient(app) as client:
            original_db = app.state.db
            try:
                app.state.db = FakeDB()
                response = client.get('/api/v1/admin/evaluation-performance?days=30&run_limit=100')
            finally:
                app.state.db = original_db
        assert response.status_code == 200
        assert response.json()['scope']['mode'] == 'account'
        assert [run['id'] for run in response.json()['runs']] == [run_id]
    finally:
        app.dependency_overrides.clear()


def test_member_dashboard_detail_uses_existing_run_ownership_check():
    uid, run_id = str(uuid4()), uuid4()

    class FakeDB:
        async def select(self, table, **params):
            assert table == 'evaluation_runs'
            assert params == {'id': f'eq.{run_id}', 'user_id': f'eq.{uid}', 'limit': 1}
            return [{
                'id': run_id,
                'status': 'completed',
                'created_at': datetime.now(timezone.utc),
                'original_text': 'must not be returned',
                'failure_reason': 'private diagnostic',
            }]

    app.dependency_overrides[user] = lambda: uid
    try:
        with TestClient(app) as client:
            original_db = app.state.db
            try:
                app.state.db = FakeDB()
                response = client.get(f'/api/v1/member/evaluation-performance/{run_id}')
            finally:
                app.state.db = original_db
        assert response.status_code == 200
        result = response.json()
        assert result['run']['id'] == str(run_id)
        assert result['run']['availability']['llm']['status'] == 'unsupported'
        assert 'original_text' not in response.text
        assert 'private diagnostic' not in response.text
    finally:
        app.dependency_overrides.clear()


def test_execution_report_returns_stored_markdown_only_after_run_ownership_check():
    uid, run_id = str(uuid4()), uuid4()
    markdown = '# 실행 기록\n\n| 내용 |\n|---|\n\n```json\n{"value": "<원문>"}\n```\n'

    class FakeDB:
        async def select(self, table, **params):
            if table == 'evaluation_runs':
                assert params == {'id': f'eq.{run_id}', 'user_id': f'eq.{uid}', 'limit': 1}
                return [{'id': run_id, 'user_id': uid}]
            assert table == 'intermediate_artifacts'
            assert params == {
                'run_id': f'eq.{run_id}',
                'artifact_type': 'eq.execution_report',
                'select': 'content',
                'order': 'created_at.desc',
                'limit': 1,
            }
            return [{'content': {'markdown': markdown, 'run_id': str(run_id)}}]

    app.dependency_overrides[user] = lambda: uid
    try:
        with TestClient(app) as client:
            original_db = app.state.db
            try:
                app.state.db = FakeDB()
                response = client.get(f'/api/v1/evaluations/{run_id}/execution-report')
            finally:
                app.state.db = original_db
        assert response.status_code == 200
        assert response.json() == {'run_id': str(run_id), 'markdown': markdown}
    finally:
        app.dependency_overrides.clear()


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


@pytest.mark.parametrize('endpoint', ['result', 'status', 'report'])
def test_saved_evaluation_responses_accept_postgres_types(endpoint):
    uid = str(uuid4())
    run_id, match_id, report_id = uuid4(), uuid4(), uuid4()
    stamp = datetime(2026, 10, 12, 23, 54, 9, tzinfo=timezone.utc)
    markdown = '# 평가 결과\n\n- 근거: Python과 SQL 경험\n'
    match = {
        'id': match_id, 'run_id': run_id, 'created_at': stamp,
        'resume_completeness': Decimal('82.5'), 'job_fit': Decimal('75.25'),
        'qualifications': Decimal('100'), 'practical_competitiveness': Decimal('80'),
        'overall_score': Decimal('84.5'), 'overall_formula': {'weights': [Decimal('0.35')]},
        'eligibility_status': 'met', 'validation_status': 'passed',
    }

    class FakeDB:
        async def select(self, table, **params):
            if table == 'evaluation_runs':
                assert params['user_id'] == f'eq.{uid}'
                return [{'id': run_id, 'status': 'completed', 'current_stage': 'completed',
                         'progress_percent': Decimal('100'), 'started_at': stamp,
                         'completed_at': stamp, 'failure_reason': None}]
            if table == 'match_results':
                return [match]
            if table == 'criterion_results':
                return [{'score': Decimal('75.25'), 'verdict': 'met', 'confidence': Decimal('0.6'),
                         'reasoning_summary': '원문 근거 확인', 'improvement_suggestion': '',
                         'evidence': [{'source': 'resume', 'quote': 'Python과 SQL 경험'}],
                         'validation_status': 'passed',
                         'evaluation_criteria': {'criterion_code': 'B1', 'weight': Decimal('0.45')}}]
            assert table == 'analysis_reports'
            return [{'id': report_id, 'match_result_id': match_id, 'status': 'completed',
                     'created_at': stamp, 'completed_at': stamp, 'report_text': markdown,
                     'report_data': {'criteria': {'B1': {'comparison_basis': '공고 원문'}}}}]

    path = (f'/api/v1/evaluations/{run_id}/result' if endpoint == 'result' else
            f'/api/v1/evaluations/{run_id}' if endpoint == 'status' else
            f'/api/v1/reports/{report_id}')
    app.dependency_overrides[user] = lambda: uid
    try:
        with TestClient(app) as client:
            original_db = app.state.db
            try:
                app.state.db = FakeDB()
                response = client.get(path)
            finally:
                app.state.db = original_db
        assert response.status_code == 200
        body = response.json()
        if endpoint == 'result':
            assert body['id'] == str(match_id)
            assert body['run_id'] == str(run_id)
            assert body['created_at'] == stamp.isoformat()
            assert body['job_fit'] == 75.25
            assert body['overall_formula']['weights'] == [0.35]
            assert body['criteria'][0]['evaluation_criteria']['weight'] == 0.45
            assert body['reports'][0]['id'] == str(report_id)
            assert body['reports'][0]['created_at'] == stamp.isoformat()
        elif endpoint == 'status':
            assert body['id'] == str(run_id)
            assert body['completed_at'] == stamp.isoformat()
        else:
            assert body['id'] == str(report_id)
            assert body['created_at'] == stamp.isoformat()
            assert body['completed_at'] == stamp.isoformat()
            assert body['report_text'] == markdown
        assert match['id'] == match_id
        assert isinstance(match['created_at'], datetime)
    finally:
        app.dependency_overrides.clear()
