# CareerLens 백엔드와 Render 배포

Python 3.13 (`.python-version`으로 고정). FastAPI 한 프로세스가 API와 Evaluation Worker를 함께 실행합니다. 데이터베이스는 Render PostgreSQL이며 비동기 psycopg 연결을 사용합니다.

같은 프로세스가 `frontend`의 Flask 앱도 제공하므로 Render 서비스 주소 `/`에서 화면을 열 수 있습니다. FastAPI의 API·`/docs`·health 경로를 먼저 처리하고, 화면·정적 파일·파일 변환·공개 공고 목록 요청을 프론트 앱으로 연결합니다. 시작 명령은 기존 `uvicorn app.main:app --host 0.0.0.0 --port $PORT`를 사용합니다. 프론트 `BACKEND_URL` 설정은 필요하지 않습니다. 루트 `requirements.txt`가 프론트 의존성도 설치합니다.

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

교육용 AIO 2기 팀 워크스페이스에는 `blueprints/team3.yaml`을 사용합니다. 루트 `render.yaml`은 독립 워크스페이스에서 쓸 수 있는 CareerLens 전용 Blueprint입니다.

1. 프로젝트를 GitHub에 push하고 Render에서 **AIO 2기** 워크스페이스를 선택한 뒤 **New → Blueprint**로 CareerLens 저장소를 연결합니다.
2. Blueprint Name은 `AIO2-team3`, Blueprint Path는 `blueprints/team3.yaml`로 지정합니다. `aio2-team3`, `agentservice-team3`, `agent-db-team3` 이름은 공유 워크스페이스의 3팀 리소스에 연결되므로 바꾸지 않습니다. Blueprint 미리보기에서 해당 3개 이름과 가이드의 예상 요금을 확인합니다.
3. Render가 요청하면 `OPENAI_API_KEY`와 프론트엔드의 `CORS_ORIGINS`를 입력하고 Blueprint를 생성합니다. `JWT_SECRET_KEY`는 Render가 생성하며 `DATABASE_URL`은 팀 DB의 내부 연결값으로 연결됩니다.
4. DB가 Available이 된 뒤 로컬에서 External Database URL을 `DATABASE_URL` 환경변수로 설정해 새 DB 스키마를 초기화하고 확인합니다. 이 작업은 새 DB에서 한 번만 수행하세요.

```powershell
$env:DATABASE_URL = 'Render의 external connection string'
.\.venv\Scripts\python.exe -m scripts.apply_runtime_migration
.\.venv\Scripts\python.exe -m scripts.setup_checkpoints
.\.venv\Scripts\python.exe -m scripts.seed_data --limit 100
.\.venv\Scripts\python.exe -m scripts.check_db
Remove-Item Env:DATABASE_URL
```

5. 서비스 상태 확인은 `/healthz`, DB 확인은 `/health` 또는 `scripts.check_db`로 합니다. `/docs`, 회원가입·로그인, Markdown 업로드, 공고 조회, 평가 생성·진행률·결과 다운로드도 확인합니다.

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
