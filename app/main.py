import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.wsgi import WSGIMiddleware
from frontend.server import create_app as create_frontend_app
from app.core.config import settings
from app.infrastructure.database.postgres import DB, DatabaseError
from app.integrations.llm.client import LLM
from app.api.v1.routes.api import router
from workers.evaluation import run_worker

log = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app):
    config = settings()
    if not config.auth_enabled: raise RuntimeError('Authentication cannot be disabled for this backend')
    if len(config.jwt_secret_key.get_secret_value()) < 32:
        raise RuntimeError('JWT_SECRET_KEY must contain at least 32 characters')
    db = DB(config)
    await db.open()
    app.state.config, app.state.db, app.state.llm = config, db, LLM(config)
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


@app.middleware('http')
async def utf8_json_charset(request: Request, call_next):
    response = await call_next(request)
    if response.headers.get('content-type') == 'application/json':
        response.headers['content-type'] = 'application/json; charset=utf-8'
    return response


@app.exception_handler(RuntimeError)
@app.exception_handler(ValueError)
async def configuration_error(request: Request, exc: Exception):
    log.error('Request rejected by configuration or stored data: path=%s error_type=%s reason=%s',
              request.url.path, type(exc).__name__, str(exc))
    return JSONResponse({'detail': '서비스 설정 또는 입력 자료의 구조를 확인하세요.'}, status_code=503)


@app.exception_handler(DatabaseError)
async def database_error(request: Request, exc: DatabaseError):
    status = 400 if exc.status in (400, 401, 403, 422) and request.url.path.startswith('/api/v1/auth/') else 503
    return JSONResponse({'detail': '인증 요청을 확인하세요.' if status == 400 else '데이터 서비스 연결 또는 설정을 확인하세요.'}, status_code=status)


@app.get('/health', tags=['health'])
async def health(request: Request):
    await request.app.state.db.health()
    return {'status': 'ok', 'version': '0.1.0'}


@app.get('/healthz', tags=['health'])
async def healthz():
    # Render liveness checks should not turn a temporary database/LLM outage into a restart loop.
    return {'status': 'ok'}


# Keep API, docs, and health routes ahead of the frontend fallback.
# Both applications share the same process and Render URL; no HTTP proxy loop.
app.mount('/', WSGIMiddleware(create_frontend_app(backend_url='')), name='frontend')
