import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.infrastructure.database.supabase import DB, DatabaseError
from app.integrations.llm.client import LLM
from app.api.v1.routes.api import router
from workers.evaluation import run_worker


@asynccontextmanager
async def lifespan(app):
    config = settings()
    if not config.auth_enabled: raise RuntimeError('Authentication cannot be disabled for this backend')
    app.state.config, app.state.db, app.state.llm = config, DB(config), LLM(config)
    worker_task = asyncio.create_task(
        run_worker(app.state.db, app.state.llm, config),
        name='evaluation-worker',
    )
    try:
        yield
    finally:
        worker_task.cancel()
        try:
            await worker_task
        except asyncio.CancelledError:
            pass
        finally:
            await app.state.db.close()
            await app.state.llm.close()


app = FastAPI(title='CareerLens Backend', version='0.1.0', lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=[v.strip() for v in settings().cors_origins.split(',') if v.strip()],
                   allow_credentials=False, allow_methods=['GET', 'POST', 'DELETE'], allow_headers=['Authorization', 'Content-Type', 'Idempotency-Key', 'Last-Event-ID'])
app.include_router(router)


@app.exception_handler(RuntimeError)
@app.exception_handler(ValueError)
async def configuration_error(request: Request, exc: Exception):
    return JSONResponse({'detail': '서비스 설정 또는 입력 자료의 구조를 확인하세요.'}, status_code=503)


@app.exception_handler(DatabaseError)
async def database_error(request: Request, exc: DatabaseError):
    status = 400 if exc.status in (400, 401, 403, 422) and request.url.path.startswith('/api/v1/auth/') else 503
    return JSONResponse({'detail': '인증 요청을 확인하세요.' if status == 400 else '데이터 서비스 연결 또는 설정을 확인하세요.'}, status_code=status)


@app.get('/health', tags=['health'])
async def health():
    return {'status': 'ok', 'version': '0.1.0'}
