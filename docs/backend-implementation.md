# CareerLens 백엔드와 Render 배포

Python 3.12 이상. FastAPI 한 프로세스가 API와 Evaluation Worker를 함께 실행합니다. 데이터베이스는 Render PostgreSQL이며 비동기 psycopg 연결을 사용합니다.

## 로컬 실행

1. `.env.example`을 참고해 `.env`에 `DATABASE_URL`, `JWT_SECRET_KEY`, `OPENAI_API_KEY`를 설정합니다. JWT 키는 `python -c "import secrets; print(secrets.token_urlsafe(48))"`로 생성합니다.
2. **새 빈 PostgreSQL DB에서만** Render 통합 스키마를 적용합니다.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m scripts.apply_runtime_migration
.\.venv\Scripts\python.exe -m scripts.setup_checkpoints
.\.venv\Scripts\python.exe -m scripts.seed_data --limit 100
.\.venv\Scripts\python.exe -m scripts.check_connections
```

`scripts.apply_runtime_migration`은 `public` 스키마에 테이블이 이미 있으면 중단합니다. 기존 DB에 재실행하지 마세요. 실제 Supabase 사용자의 계정, 이력서, 평가 기록은 자동 복사되지 않습니다. 사용자는 새 계정을 만들어야 하고 기존 이력서 파일은 다시 업로드해야 합니다.

서버 실행:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 5101 --loop app.core.asyncio:uvicorn_loop_factory
```

## Render 배포

저장소 루트의 `render.yaml` Blueprint를 사용하면 Web Service 하나와 PostgreSQL 하나를 생성할 수 있습니다.

1. 프로젝트를 GitHub에 push하고 Render에서 **New → Blueprint**로 저장소를 연결합니다.
2. Render가 요청하면 `OPENAI_API_KEY`를 입력하고 Blueprint를 생성합니다. `JWT_SECRET_KEY`는 Render가 생성하며 `DATABASE_URL`은 같은 Blueprint의 PostgreSQL 내부 연결값으로 연결됩니다.
3. 새 DB에 한 번만 로컬에서 연결해 스키마를 초기화합니다. Render 대시보드의 내부 URL은 로컬 컴퓨터에서 사용할 수 없으므로 DB Info 화면의 external connection string을 이용하고, 초기화 후 외부 접근을 제한합니다.

```powershell
$env:DATABASE_URL = 'Render의 external connection string'
.\.venv\Scripts\python.exe -m scripts.apply_runtime_migration
.\.venv\Scripts\python.exe -m scripts.setup_checkpoints
.\.venv\Scripts\python.exe -m scripts.seed_data --limit 100
Remove-Item Env:DATABASE_URL
```

4. Render Web Service의 `CORS_ORIGINS`에 실제 프론트엔드 origin을 설정합니다. Render 시작 명령은 Blueprint에 포함되어 있고 `/health`는 DB 연결까지 확인합니다.
5. 배포 후 서비스 `/health`, `/docs`, 회원가입·로그인, Markdown 업로드, 공고 조회, 평가 생성·진행률·결과 다운로드를 확인합니다.

Render PostgreSQL은 지원 버전에서 pgvector를 제공합니다. 통합 스키마가 `CREATE EXTENSION vector`를 실행합니다. [Render PostgreSQL 확장 안내](https://render.com/docs/postgresql-extensions)

체크포인터는 `career_lens_checkpoints` 전용 스키마에 저장합니다. 한 번 초기화한 뒤 Worker가 자동 실행됩니다. 여러 Web Service 인스턴스가 떠도 DB lease가 평가 작업을 한 곳에서만 선점하게 합니다.

## API 흐름

Swagger: `/docs`. `POST /api/v1/auth/signup` 또는 `/api/v1/auth/login`의 access token을 Authorize에 넣습니다. `/api/v1/auth/refresh`는 일회성 Refresh Token을 회전합니다.

`POST /api/v1/resumes`에 UTF-8 `.md` 업로드 → `GET /api/v1/jobs` 공고 선택 → `POST /api/v1/evaluations` → 상태/진행률/SSE → 결과와 Markdown 보고서 다운로드.

평가 파이프라인은 4개 영역의 12개 기준 병렬 평가, lease·heartbeat·복구, 진행 이벤트, 중간 산출물, LangGraph 체크포인트 및 성능 측정을 유지합니다. 원본 이력서 텍스트와 보고서 응답은 PostgreSQL에 저장됩니다. Render 파일 시스템의 보고서 사본은 임시 산출물이며 원본으로 사용하지 않습니다.

## 검증

```powershell
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m scripts.smoke_backend
```

`smoke_backend`는 새 임시 계정을 만들고 실제 LLM 평가를 실행하므로 호출 비용이 발생합니다. 요청한 경우에만 실행합니다.
