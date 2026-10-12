import asyncio
import hashlib
import json
import secrets
import time
import tiktoken
from uuid import UUID, uuid4
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Header, Query, Request
from fastapi.responses import Response, StreamingResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field, SecretStr, field_validator
import jwt
from jwt import InvalidTokenError
from pwdlib import PasswordHash
from app.application.evaluation import active_rubric
from app.application.parsing import parse_document
from app.integrations.company_info.yahoo import financial_context
from app.retrieval.indexing.markdown import digest
from app.api.v1.schemas import UploadedResume, EvaluationStarted, RunStatus, MatchResult, ReportView
from app.infrastructure.database.postgres import DatabaseError

router = APIRouter(prefix='/api/v1')
bearer = HTTPBearer(auto_error=False)
password_hasher = PasswordHash.recommended()


def services(request: Request):
    return request.app.state.db, request.app.state.llm, request.app.state.config


async def user(request: Request, token: HTTPAuthorizationCredentials | None = Depends(bearer)) -> str:
    if not token: raise HTTPException(401, '로그인이 필요합니다.')
    _, _, config = services(request)
    try:
        claims = jwt.decode(token.credentials, config.jwt_secret_key.get_secret_value(),
                            algorithms=['HS256'], issuer=config.jwt_issuer,
                            options={'require': ['sub', 'iat', 'exp', 'iss']})
        return str(UUID(claims['sub']))
    except (InvalidTokenError, KeyError, ValueError):
        raise HTTPException(401, '유효하지 않거나 만료된 로그인입니다.') from None


async def owned(db, table, ident, uid):
    rows = await db.select(table, id=f'eq.{ident}', user_id=f'eq.{uid}', limit=1)
    if not rows: raise HTTPException(404, '자료를 찾을 수 없습니다.')
    return rows[0]


class Credentials(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: SecretStr = Field(min_length=8)

    @field_validator('email')
    @classmethod
    def normalize_email(cls, value: str) -> str:
        value = value.strip().lower()
        local, separator, domain = value.partition('@')
        if not separator or not local or '.' not in domain or any(char.isspace() for char in value):
            raise ValueError('A valid email address is required')
        return value


class EvaluationRequest(BaseModel):
    resume_id: UUID
    job_posting_id: UUID


@router.post('/auth/signup', status_code=201, tags=['auth'])
async def signup(body: Credentials, request: Request):
    db, _, _ = services(request)
    try:
        hashed = await asyncio.to_thread(password_hasher.hash, body.password.get_secret_value())
        account = await db.create_account(body.email, hashed)
    except DatabaseError as error:
        if error.status == 409: raise HTTPException(409, '이미 등록된 이메일입니다.') from None
        raise
    access, refresh_token = await issue_tokens(db, request, str(account['id']))
    return {'user_id': str(account['id']), 'access_token': access,
            'refresh_token': refresh_token, 'email_confirmation_required': False}


@router.post('/auth/login', tags=['auth'])
async def login(body: Credentials, request: Request):
    db, _, _ = services(request)
    rows = await db.select('app_users', select='id,email,password_hash', email=f"eq.{body.email}", limit=1)
    if not rows:
        raise HTTPException(401, '이메일 또는 비밀번호가 올바르지 않습니다.')
    try:
        valid = await asyncio.to_thread(password_hasher.verify, body.password.get_secret_value(), rows[0]['password_hash'])
    except (ValueError, TypeError):
        valid = False
    if not valid:
        raise HTTPException(401, '이메일 또는 비밀번호가 올바르지 않습니다.')
    access, refresh_token = await issue_tokens(db, request, str(rows[0]['id']))
    return {'access_token': access, 'refresh_token': refresh_token,
            'expires_in': request.app.state.config.access_token_seconds, 'token_type': 'bearer'}


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def access_token(request: Request, uid: str) -> str:
    config = request.app.state.config
    now = int(time.time())
    return jwt.encode({'sub': uid, 'iss': config.jwt_issuer, 'iat': now,
                       'exp': now + config.access_token_seconds},
                      config.jwt_secret_key.get_secret_value(), algorithm='HS256')


async def issue_tokens(db, request: Request, uid: str):
    config = request.app.state.config
    refresh = secrets.token_urlsafe(48)
    expiry = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() + config.refresh_token_days * 86400))
    await db.insert('refresh_tokens', {'user_id': uid, 'token_hash': token_hash(refresh), 'expires_at': expiry})
    return access_token(request, uid), refresh


class RefreshToken(BaseModel):
    refresh_token: SecretStr


@router.post('/auth/refresh', tags=['auth'])
async def refresh(body: RefreshToken, request: Request):
    db, _, _ = services(request)
    old_token = body.refresh_token.get_secret_value()
    new_token = secrets.token_urlsafe(48)
    config = request.app.state.config
    expiry = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() + config.refresh_token_days * 86400))
    uid = await db.rotate_refresh_token(token_hash(old_token), token_hash(new_token), expiry)
    if not uid:
        raise HTTPException(401, '유효하지 않거나 만료된 Refresh Token입니다.')
    return {'access_token': access_token(request, str(uid)), 'refresh_token': new_token,
            'expires_in': config.access_token_seconds, 'token_type': 'bearer'}


@router.get('/me', tags=['auth'])
async def me(request: Request, uid: str = Depends(user)):
    db, _, _ = services(request)
    return (await db.select('profiles', user_id=f'eq.{uid}', limit=1))[0]


@router.get('/admin/evaluation-performance', tags=['admin'])
async def evaluation_performance(
    request: Request,
    days: int = Query(30, ge=1, le=90),
    run_limit: int = Query(100, ge=1, le=200),
    uid: str = Depends(user),
):
    db, _, config = services(request)
    try:
        allowed = {
            str(UUID(value.strip()))
            for value in config.admin_user_ids.split(',')
            if value.strip()
        }
    except ValueError:
        raise HTTPException(503, 'ADMIN_USER_IDS에 올바른 사용자 UUID를 설정해야 합니다.') from None
    if uid not in allowed:
        raise HTTPException(403, '성능 대시보드 관리자 권한이 없습니다.')
    return await db.rpc('get_evaluation_performance', {
        'p_days': days,
        'p_run_limit': run_limit,
    })


@router.post('/resumes', status_code=201, tags=['resumes'], response_model=UploadedResume)
async def upload_resume(request: Request, file: UploadFile = File(...), title: str = Form('My resume'), uid: str = Depends(user)):
    db, _, config = services(request)
    if not file.filename or not file.filename.lower().endswith('.md'): raise HTTPException(415, '.md 파일만 업로드할 수 있습니다.')
    data = await file.read(config.upload_max_bytes + 1)
    if len(data) > config.upload_max_bytes: raise HTTPException(413, '파일 크기 제한을 초과했습니다.')
    try: text = data.decode('utf-8-sig')
    except UnicodeDecodeError: raise HTTPException(422, 'UTF-8 Markdown 파일이 필요합니다.') from None
    if not text.strip() or '\x00' in text: raise HTTPException(422, '비어 있거나 올바르지 않은 텍스트입니다.')
    if len(tiktoken.get_encoding('cl100k_base').encode(text)) > config.max_document_tokens:
        raise HTTPException(413, '평가 가능한 문서 길이를 초과했습니다.')
    if len(title) > 200: raise HTTPException(422, '제목은 200자 이하로 입력하세요.')
    ident = str(uuid4())
    result = await db.insert('resumes', {'id': ident, 'user_id': uid, 'title': title, 'original_text': text,
                                        'parse_status': 'ready', 'parsed_data': {'format': 'markdown', 'source_hash': digest(text)}, 'parser_version': 'markdown-v1'})
    return {'id': ident, 'parse_status': result[0]['parse_status'], 'title': title}


@router.get('/resumes', tags=['resumes'])
async def resumes(request: Request, uid: str = Depends(user), limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0)):
    db, _, _ = services(request)
    return await db.select('resumes', user_id=f'eq.{uid}', select='id,title,version,parse_status,created_at', order='created_at.desc', limit=limit, offset=offset)


@router.get('/resumes/{resume_id}', tags=['resumes'])
async def resume(resume_id: UUID, request: Request, uid: str = Depends(user)):
    db, _, _ = services(request)
    return await owned(db, 'resumes', resume_id, uid)


@router.delete('/resumes/{resume_id}', status_code=204, tags=['resumes'])
async def delete_resume(resume_id: UUID, request: Request, uid: str = Depends(user)):
    db, _, _ = services(request)
    row = await owned(db, 'resumes', resume_id, uid)
    runs = await db.select('evaluation_runs', resume_id=f'eq.{resume_id}', limit=1)
    if runs: raise HTTPException(409, '평가 이력이 있는 이력서 삭제는 보존 데이터 정리 기능 구현 후 지원합니다.')
    await db.delete('resumes', id=f'eq.{resume_id}', user_id=f'eq.{uid}')
    return Response(status_code=204)


@router.get('/jobs', tags=['jobs'])
async def jobs(request: Request, uid: str = Depends(user), limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0), company_id: UUID | None = None):
    db, _, _ = services(request)
    filters = {'company_id': f'eq.{company_id}'} if company_id else {}
    return await db.select('job_postings', select='id,company_id,title,career_min_months,education_level,source_name,source_external_id', order='collected_at.desc', limit=limit, offset=offset, **filters)


@router.get('/jobs/{job_id}', tags=['jobs'])
async def job(job_id: UUID, request: Request, uid: str = Depends(user)):
    db, _, _ = services(request)
    rows = await db.select('job_postings', id=f'eq.{job_id}', limit=1)
    if not rows: raise HTTPException(404, '공고를 찾을 수 없습니다.')
    return rows[0]


@router.get('/companies/{company_id}', tags=['companies'])
async def company(company_id: UUID, request: Request, uid: str = Depends(user)):
    db, _, _ = services(request)
    rows = await db.select('companies', id=f'eq.{company_id}', limit=1)
    if not rows: raise HTTPException(404, '기업을 찾을 수 없습니다.')
    return {**rows[0], 'tickers': await db.select('company_tickers', company_id=f'eq.{company_id}')}


@router.get('/companies/{company_id}/financials', tags=['companies'])
async def financials(company_id: UUID, request: Request, uid: str = Depends(user)):
    db, _, _ = services(request)
    row = await company(company_id, request, uid)
    ids = [r['id'] for r in row['tickers']]
    if not ids: return []
    return await db.select('company_financials', company_ticker_id=f"in.({','.join(ids)})", order='collected_at.desc', limit=20)


@router.post('/evaluations', status_code=202, tags=['evaluations'], response_model=EvaluationStarted)
async def start(body: EvaluationRequest, request: Request, uid: str = Depends(user), idempotency_key: str | None = Header(None, max_length=128)):
    db, _, config = services(request)
    resume = await owned(db, 'resumes', body.resume_id, uid)
    if resume['parse_status'] != 'ready': raise HTTPException(409, '이력서가 평가 가능한 상태가 아닙니다.')
    posting = await job(body.job_posting_id, request, uid)
    rubric, _ = await active_rubric(db)
    fingerprint = digest(json.dumps({'resume_id': str(body.resume_id), 'job_id': str(body.job_posting_id), 'resume_hash': digest(resume['original_text']),
                                     'job_hash': digest(posting['description']), 'rubric_id': str(rubric['id']), 'scoring': 'career-lens-v1', 'model': config.openai_model}, sort_keys=True))
    if idempotency_key:
        existing = await db.select('evaluation_runs', user_id=f'eq.{uid}', idempotency_key=f'eq.{idempotency_key}', limit=1)
        if existing:
            if existing[0]['input_fingerprint'] != fingerprint: raise HTTPException(409, '같은 중복방지 키가 다른 입력에 사용되었습니다.')
            return {'run_id': existing[0]['id'], 'status': existing[0]['status']}
    companies = await db.select('companies', id=f"eq.{posting['company_id']}", limit=1) if posting.get('company_id') else []
    finance = await financial_context(db, posting.get('company_id'), companies[0]['name'] if companies else '')
    # JSONB snapshots may contain UUID, date, datetime, or Decimal DB values.
    # Normalize the complete payload before the adapter wraps it as JSONB.
    snapshot = json.loads(json.dumps({
        'resume': resume,
        'job': posting,
        'resume_hash': digest(resume['original_text']),
        'job_hash': digest(posting['description']),
        'finance': finance,
        'model_config': {'model': config.openai_model, 'embedding_model': config.embedding_model,
                         'embedding_dimensions': config.embedding_dimensions},
    }, default=str))
    runs = await db.rpc('create_evaluation', {'p_user': uid, 'p_resume': str(body.resume_id), 'p_job': str(body.job_posting_id), 'p_rubric': str(rubric['id']),
        'p_key': idempotency_key, 'p_fingerprint': fingerprint, 'p_model': config.openai_model,
        'p_snapshot': snapshot})
    return {'run_id': str(runs[0]['id']), 'status': runs[0]['status'], 'status_url': f"/api/v1/evaluations/{runs[0]['id']}"}


@router.get('/evaluations', tags=['evaluations'])
async def evaluations(request: Request, uid: str = Depends(user), limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0)):
    db, _, _ = services(request)
    return await db.select('evaluation_runs', user_id=f'eq.{uid}', select='id,status,current_stage,progress_percent,created_at', order='created_at.desc', limit=limit, offset=offset)


@router.get('/evaluations/{run_id}', tags=['evaluations'], response_model=RunStatus)
async def evaluation(run_id: UUID, request: Request, uid: str = Depends(user)):
    db, _, _ = services(request)
    row = await owned(db, 'evaluation_runs', run_id, uid)
    return {k: row.get(k) for k in ['id', 'status', 'current_stage', 'progress_percent', 'started_at', 'completed_at', 'failure_reason']}


@router.get('/evaluations/{run_id}/progress', tags=['evaluations'])
async def evaluation_progress(
    run_id: UUID,
    request: Request,
    uid: str = Depends(user),
    after_id: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
):
    db, _, _ = services(request)
    run = await owned(db, 'evaluation_runs', run_id, uid)
    events = await db.select(
        'progress_events',
        run_id=f'eq.{run_id}',
        id=f'gt.{after_id}',
        order='id.asc',
        limit=limit,
    )
    return {
        'run': {
            key: run.get(key)
            for key in ['id', 'status', 'current_stage', 'progress_percent', 'started_at', 'completed_at', 'failure_reason']
        },
        'events': events,
    }


@router.post('/evaluations/{run_id}/cancel', tags=['evaluations'])
async def cancel(run_id: UUID, request: Request, uid: str = Depends(user)):
    db, _, _ = services(request)
    await owned(db, 'evaluation_runs', run_id, uid)
    rows = await db.update('evaluation_runs', {'status': 'cancelled'}, id=f'eq.{run_id}', user_id=f'eq.{uid}', status='in.(queued,running)')
    if not rows: raise HTTPException(409, '이미 종료된 평가입니다.')
    return {'run_id': str(run_id), 'status': 'cancelled'}


@router.get('/evaluations/{run_id}/events', tags=['evaluations'])
async def events(run_id: UUID, request: Request, uid: str = Depends(user), last_event_id: int = Header(0, ge=0)):
    db, _, _ = services(request)
    await owned(db, 'evaluation_runs', run_id, uid)
    async def stream():
        cursor = last_event_id
        while not await request.is_disconnected():
            rows = await db.select('progress_events', run_id=f'eq.{run_id}', id=f'gt.{cursor}', order='id.asc', limit=100)
            for row in rows:
                cursor = row['id']
                yield f"id: {cursor}\nevent: progress\ndata: {json.dumps(row, ensure_ascii=False)}\n\n"
            run = await evaluation(run_id, request, uid)
            if run['status'] in ('completed', 'partial', 'failed', 'cancelled'):
                if len(rows) == 100: continue
                yield f"event: done\ndata: {json.dumps(run)}\n\n"
                break
            yield ': heartbeat\n\n'
            await asyncio.sleep(2)
    return StreamingResponse(stream(), media_type='text/event-stream', headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})


@router.get('/evaluations/{run_id}/result', tags=['evaluations'], response_model=MatchResult)
async def result(run_id: UUID, request: Request, uid: str = Depends(user)):
    db, _, _ = services(request)
    run = await owned(db, 'evaluation_runs', run_id, uid)
    if run['status'] not in ('completed', 'partial'): raise HTTPException(409, '평가 결과가 아직 확정되지 않았습니다.')
    rows = await db.select('match_results', run_id=f'eq.{run_id}', limit=1)
    if not rows: raise HTTPException(404, '결과가 없습니다.')
    criteria = await db.select('criterion_results', run_id=f'eq.{run_id}', select='score,verdict,confidence,reasoning_summary,improvement_suggestion,evidence,validation_status,evaluation_criteria(criterion_code,name_ko,domain_code,weight)')
    reports = await db.select('analysis_reports', match_result_id=f"eq.{rows[0]['id']}", select='id,status,created_at,report_data', order='created_at.desc')
    details = reports[0].get('report_data', {}).get('criteria', {}) if reports else {}
    for item in criteria:
        code = item['evaluation_criteria']['criterion_code']
        detail = details.get(code, {})
        item.update({k: detail.get(k, default) for k, default in [('comparison_basis', ''), ('estimated', False), ('issues', [])]})
    return {**rows[0], 'criteria': criteria, 'reports': [{k: r[k] for k in ['id','status','created_at']} for r in reports]}


async def report_owned(db, report_id, uid):
    rows = await db.select('analysis_reports', id=f'eq.{report_id}', limit=1)
    if not rows: raise HTTPException(404, '보고서가 없습니다.')
    match = await db.select('match_results', id=f"eq.{rows[0]['match_result_id']}", limit=1)
    if not match: raise HTTPException(404, '보고서가 없습니다.')
    await owned(db, 'evaluation_runs', match[0]['run_id'], uid)
    return rows[0]


@router.get('/reports/{report_id}', tags=['reports'], response_model=ReportView)
async def report(report_id: UUID, request: Request, uid: str = Depends(user)):
    db, _, _ = services(request)
    row = await report_owned(db, report_id, uid)
    return {k: row.get(k) for k in ['id', 'status', 'report_text', 'created_at', 'completed_at']}


@router.get('/reports/{report_id}/download', tags=['reports'])
async def download(report_id: UUID, request: Request, uid: str = Depends(user)):
    db, _, _ = services(request)
    row = await report_owned(db, report_id, uid)
    if row['status'] != 'completed' or not row.get('report_text'): raise HTTPException(409, '보고서 생성이 완료되지 않았습니다.')
    return Response(row['report_text'], media_type='text/markdown; charset=utf-8', headers={'Content-Disposition': f'attachment; filename="match-report-{report_id}.md"'})
