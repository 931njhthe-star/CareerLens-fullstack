"""Explicit live integration test: temporary account, paid model calls, cleanup."""
import asyncio
from uuid import uuid4
import httpx
from psycopg import AsyncConnection
from psycopg.rows import dict_row
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from app.core.asyncio import run
from app.core.config import ROOT
from app.main import app


async def main():
    stage, user_id, thread_id = 'startup', None, None
    run_id = None
    async with app.router.lifespan_context(app):
        db, config = app.state.db, app.state.config
        conn = await AsyncConnection.connect(config.database_url.get_secret_value(), autocommit=True, prepare_threshold=0,
                                             row_factory=dict_row, options='-c search_path=career_lens_checkpoints,public')
        saver = AsyncPostgresSaver(conn)
        try:
            stage = 'temporary_account'
            email, password = f'career-lens-test-{uuid4().hex}@example.invalid', uuid4().hex + 'Aa!'
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as api:
                created = await api.post('/api/v1/auth/signup', json={'email': email, 'password': password})
                assert created.status_code == 201, f'HTTP {created.status_code}'
                user_id = created.json()['user_id']
                api.headers['Authorization'] = 'Bearer ' + created.json()['access_token']
                stage = 'markdown_upload'
                source = sorted((ROOT/'app/modules/resumes').glob('CV-001_*.md'))[0]
                response = await api.post('/api/v1/resumes', files={'file': ('resume.md', source.read_bytes(), 'text/markdown')}, data={'title': 'Temporary integration fixture'})
                assert response.status_code == 201, f'HTTP {response.status_code}'
                resume_id = response.json()['id']
                jobs = await db.select('job_postings', source_name='eq.local_markdown', source_external_id='eq.001.md', limit=1)
                stage = 'enqueue'
                key = uuid4().hex
                body = {'resume_id': resume_id, 'job_posting_id': jobs[0]['id']}
                response = await api.post('/api/v1/evaluations', json=body, headers={'Idempotency-Key': key})
                assert response.status_code == 202, f'HTTP {response.status_code}'
                run_id = response.json()['run_id']
                duplicate = await api.post('/api/v1/evaluations', json=body, headers={'Idempotency-Key': key})
                assert duplicate.json()['run_id'] == run_id
                stage = 'evaluation_worker'
                rows = await db.select('evaluation_runs', id=f'eq.{run_id}', select='graph_thread_id', limit=1)
                assert rows, 'Evaluation run was not persisted'
                thread_id = rows[0]['graph_thread_id']
                print('Live pipeline: backend evaluation worker started', flush=True)
                deadline = asyncio.get_running_loop().time() + config.evaluation_timeout_seconds + config.worker_lease_seconds
                while True:
                    status = (await api.get(f'/api/v1/evaluations/{run_id}')).json()
                    if status['status'] in ('completed', 'partial', 'failed', 'cancelled'):
                        break
                    if asyncio.get_running_loop().time() >= deadline:
                        raise TimeoutError('Backend evaluation worker did not finish before the deadline')
                    await asyncio.sleep(min(2, config.worker_poll_seconds))
                assert status['status'] in ('completed', 'partial'), f"Worker state {status['status']}, reason {status.get('failure_reason')}"
                stage = 'result_and_report'
                response = await api.get(f'/api/v1/evaluations/{run_id}/result')
                assert response.status_code == 200, f'HTTP {response.status_code}'
                result = response.json()
                assert len(result['criteria']) == 12
                report_id = result['reports'][0]['id']
                report = await api.get(f'/api/v1/reports/{report_id}/download')
                assert report.status_code == 200 and 'text/markdown' in report.headers['content-type']
                destination = ROOT/'.runtime/integration-report.md'
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_text(report.text, encoding='utf-8')
                print('Live pipeline: ' + status['status'] + '; twelve criteria and Markdown download verified', flush=True)
                print('Report: .runtime/integration-report.md', flush=True)
        except Exception as error:
            print(f'Smoke test failed at {stage}: {type(error).__name__}', flush=True)
            if isinstance(error, AssertionError):
                print(str(error), flush=True)
            raise SystemExit(1) from None
        finally:
            if thread_id:
                await saver.adelete_thread(thread_id)
            if user_id:
                await db.delete('app_users', id=f'eq.{user_id}')
            await conn.close()
            print('Temporary account, resume, evaluation and checkpoint cleanup finished.', flush=True)


if __name__ == '__main__':
    run(main())
