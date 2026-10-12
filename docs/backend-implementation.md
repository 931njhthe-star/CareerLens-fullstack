# CareerLens 백엔드 실행 안내

Python 3.12 이상. FastAPI API 서버가 LangGraph evaluation worker도 함께 실행합니다.

## 최초 설정

1. `.env`의 `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` 입력.
2. Supabase SQL Editor에서 `migrations/001_backend_runtime.sql`, `migrations/002_latest_evaluation_wins.sql`을 순서대로 실행하거나 `python -m scripts.apply_runtime_migration`을 실행합니다. 기존 v4 전체 SQL을 재실행하지 마세요.
3. Storage `resume-files` MIME 설정에 `text/markdown`, `text/plain`, `text/x-markdown` 추가. 비공개 유지.
4. Auth 이메일·비밀번호 가입 활성화. 이메일 확인이 켜져 있으면 확인 후 로그인.

프로젝트 루트(`app`, `workers`, `frontend` 폴더가 있는 위치)에서 실행합니다.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m scripts.check_connections
.\.venv\Scripts\python.exe -m scripts.setup_checkpoints
.\.venv\Scripts\python.exe -m scripts.seed_data --limit 100
```

이제 API 서버가 evaluation worker도 함께 실행하므로 아래 서버 하나만 실행하면 됩니다.

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 5101 --loop app.core.asyncio:uvicorn_loop_factory
```

별도 `python -m workers.evaluation` 실행은 필요하지 않습니다. Swagger: `http://localhost:5101/docs`. `POST /api/v1/auth/signup` → 이메일 확인 → `POST /api/v1/auth/login` → Swagger Authorize에 access_token 입력.

`POST /api/v1/resumes`에 UTF-8 `.md` 업로드 → `GET /api/v1/jobs` 공고 선택 → `POST /api/v1/evaluations`에 resume_id/job_posting_id → 상태 또는 SSE 조회 → result 조회 → reports/{id}/download로 Markdown 다운로드.

보고서는 자동 생성됩니다. PDF 및 별도 보고서 재생성 API는 이 버전에 포함하지 않습니다.

## 평가 정책

`app/modules/analysis/scoring/rubric.py`에 12개 초기 기준과 가중치가 있습니다. 문서 자료 안의 지시는 수행하지 않습니다.
4개 영역의 12개 기준을 병렬 평가하고 근거 검증·자기 검토·선택적 독립 평가를 적용합니다. 전역 검증 실패는 영향받은 기준만 최대 1회 재평가.
근거 없는 인용은 검증 후 점수 보류. 경쟁자 실측 데이터 없이 D영역은 추정 표시, 신뢰도 상한 0.6.
미확인 점수는 null이며 종합점수 보류, 평가 제외는 가중치 재분배, 실제 0은 기하평균 전체에 0으로 반영합니다.
기존 예시 65.5점과 달리 관련 경력이 명시적으로 0이면 C1=0, 지원 자격 및 종합점수도 0이 됩니다. 이는 채택한 곱셈 정책에 따른 결과입니다.
경력은 월 단위 포함 계산, 중복 월 제거, 교육 프로젝트 제외. 인턴은 현재 기본 기준에서 제외하며, 공고가 인턴 인정을 명시하는 사례는 별도 기준 보완이 필요합니다.

## 데이터와 운영

- `scripts.seed_data`는 직속 폴더의 001~100 공고만 적재하며 목록 문서·작성 프롬프트·중복 하위 폴더는 제외합니다.
- 가상 이력서는 자동으로 사용자 계정에 넣지 않습니다. 테스트 계정으로 원하는 파일을 업로드하세요.
- 기업 티커는 저장된 company_tickers 또는 명시적 매핑만 사용. 비상장·실패는 평가 중단 없이 unavailable 처리.
- 기업 요약은 24시간 캐시. 재무 규모를 경쟁률·경쟁자 학력으로 변환하지 않습니다.
- 워커 선점은 RPC 트랜잭션, lease와 heartbeat로 관리. 중단 작업은 최대 1회 회수합니다.
- 새 평가 요청은 같은 사용자의 이전 `queued`·`running` 평가를 취소하고 새 작업 하나만 대기시킵니다. 재요청 처리와 선점은 사용자별 트랜잭션 잠금으로 직렬화합니다.
- 체크포인트는 비공개 career_lens_checkpoints 스키마. Data API exposed schemas에 추가하지 마세요.
- 서비스 키는 서버에서만 사용. 모든 사용자 자료 API에 소유권 검사를 적용합니다.
- 평가 이력이 있는 이력서 삭제는 보존 스냅샷·체크포인트 정리 구현 전까지 409로 차단합니다.
- 개발용 코드입니다. 공개 배포 전 인증/업로드 rate limit, 비용 한도, 보존 기간 및 삭제 작업을 운영환경에서 설정하세요.

## 검증

```powershell
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -c "import json; from app.main import app; print(json.dumps(app.openapi(),ensure_ascii=False))" > contracts/openapi/development.json
```

테스트는 실제 키·네트워크 없이 점수 정책, 월 합집합, 그래프 병렬 합류와 선택적 재평가, 업로드 검증, 소유권 검사를 검증합니다.

실제 통합 검증(유료 모델 호출 및 임시 테스트 계정 생성·삭제):

```powershell
.\.venv\Scripts\python.exe -m scripts.smoke_backend
```

2026-10-08 실제 Supabase 로그인, Markdown Storage 업로드, 중복 요청 방지, 작업 선점, pgvector 검색, Postgres 체크포인트, GPT-6 Luna 12개 항목 평가, 결과 API와 Markdown 다운로드를 확인했습니다.
샘플의 경력 요건 미충족을 확인했으며, 전역 검증에서 남은 설명 문제는 partial 상태와 종합점수 보류로 표시했습니다.
임시 계정·평가·Storage 파일·체크포인트는 정리했고, 로컬 `.runtime/integration-report.md`만 남겼습니다.
