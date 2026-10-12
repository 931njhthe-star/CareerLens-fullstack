import asyncio
import logging
from contextlib import AsyncExitStack
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from app.core.config import settings
from app.core.asyncio import run
from app.infrastructure.database.postgres import DB
from app.integrations.llm.client import LLM
from app.application.evaluation import execute

log = logging.getLogger('career_lens.worker')


async def heartbeat(db, run_id, worker, config):
    while True:
        await asyncio.sleep(max(1, min(5, config.worker_lease_seconds / 3)))
        rows = await db.update('evaluation_runs', {'lease_expires_at': (datetime.now(timezone.utc) + timedelta(seconds=config.worker_lease_seconds)).isoformat()},
                               id=f'eq.{run_id}', worker_id=f'eq.{worker}', status='eq.running')
        if not rows: return 'lease_lost_or_cancelled'


async def process(db, llm, config, run, worker, checkpointer):
    evaluation = asyncio.create_task(execute(db, llm, config, run, checkpointer))
    pulse = asyncio.create_task(heartbeat(db, run['id'], worker, config))
    try:
        done, _ = await asyncio.wait([evaluation, pulse], timeout=config.evaluation_timeout_seconds, return_when=asyncio.FIRST_COMPLETED)
        if pulse in done:
            pulse.result()
            evaluation.cancel()
            return
        if evaluation not in done: raise TimeoutError('Evaluation deadline exceeded')
        result = evaluation.result()
        updated = await db.update('evaluation_runs', {'status': 'partial' if result['scores']['validation_status'] == 'partial' else 'completed',
            'completed_at': datetime.now(timezone.utc).isoformat(), 'progress_percent': 100, 'current_stage': 'completed', 'lease_expires_at': None},
            id=f"eq.{run['id']}", worker_id=f'eq.{worker}', status='eq.running')
        if updated:
            await db.insert('progress_events', {'run_id': run['id'], 'stage': 'completed', 'status': 'completed', 'message': '평가 및 Markdown 보고서 완료', 'progress_percent': 100})
    except Exception as error:
        # Do not log raw exception strings: providers may include credentials or resume text.
        log.error('Evaluation failed: run=%s type=%s', run['id'], type(error).__name__)
        await db.update('evaluation_runs', {'status': 'failed', 'failure_reason': type(error).__name__, 'completed_at': datetime.now(timezone.utc).isoformat(), 'lease_expires_at': None},
                        id=f"eq.{run['id']}", worker_id=f'eq.{worker}', status='eq.running')
    finally:
        evaluation.cancel()
        pulse.cancel()
        await asyncio.gather(evaluation, pulse, return_exceptions=True)


async def _run_worker(db, llm, config):
    worker = str(uuid4())
    async with AsyncExitStack() as stack:
        saver = None
        if config.checkpoint_enabled:
            if not config.database_url.get_secret_value(): raise RuntimeError('DATABASE_URL required for checkpoint persistence')
            from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
            from psycopg import AsyncConnection
            from psycopg.rows import dict_row
            connection = await AsyncConnection.connect(config.database_url.get_secret_value(), autocommit=True, prepare_threshold=None,
                connect_timeout=10,
                row_factory=dict_row, options='-c search_path=career_lens_checkpoints,public')
            await stack.enter_async_context(connection)
            saver = AsyncPostgresSaver(connection)
            # Set up separately with scripts.setup_checkpoints, not on every startup.
        while True:
            runs = await db.rpc('claim_evaluation', {'p_worker': worker, 'p_lease_seconds': config.worker_lease_seconds})
            if runs: await process(db, llm, config, runs[0], worker, saver)
            else: await asyncio.sleep(config.worker_poll_seconds)


async def run_worker(db, llm, config):
    while True:
        try:
            await _run_worker(db, llm, config)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            log.error('Evaluation worker stopped: type=%s; restarting', type(error).__name__)
            await asyncio.sleep(config.worker_poll_seconds)


async def main():
    config = settings()
    db, llm = DB(config), LLM(config)
    try:
        await run_worker(db, llm, config)
    finally:
        await db.close()
        await llm.close()


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    run(main())
