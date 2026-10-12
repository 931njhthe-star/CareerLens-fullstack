# Frontend 구조

`frontend`는 main 브랜치의 독립 Git 저장소입니다. 화면 코드, 테스트, 문서, 배포 설정을 이 저장소 안에 둡니다.
현재 화면 기능은 구현 전이며, 구조 문서와 API 계약 동기화 보조 도구가 준비되어 있습니다. 프레임워크와 앱 의존성은 후속 구현에서 추가합니다.

<<<<<<< Updated upstream
## 전체 구조
=======
교육용 CareerLens의 소개 → 이력서 → 희망 직무 선택 → 관련 채용공고 목록·상세 → 모의지원 결과 확인 → 눈 모션 분석 → 결과 화면입니다. 추가 질문 없이 이력서와 선택한 공고로 바로 분석합니다. 비회원도 업로드와 실제 분석을 완료할 수 있으며, 결과는 마지막 로그인·회원가입 후 열람합니다. HTML/CSS와 브라우저 기본 ES module을 사용하고, Python 서버가 정적 파일 제공 및 같은 출처 API 프록시를 담당합니다. 화면 실행에는 npm 설치나 프론트엔드 빌드가 필요하지 않습니다. 기존 공고 카탈로그는 별도 탐색 기능으로 보존합니다.

## 처음 내려받아 실행하기 (Windows)

로컬에서 프론트엔드와 백엔드를 함께 실행하려면 Python 3.12 이상을 설치하고, 두 저장소를 각각 Clone해 같은 상위 폴더에 둡니다.

```text
작업폴더\
├── CareerLens-frontend\
└── CareerLens-backend\
```

백엔드 저장소는 [CareerLens Backend](https://github.com/931njhthe-star/CareerLens-backend)입니다. 아래 `cd .\...` 명령은 두 저장소의 상위 폴더인 `작업폴더`에서 PowerShell을 열었다고 가정합니다. 프론트엔드 저장소를 먼저 Clone한 다음, 같은 상위 폴더에서 백엔드도 Clone하세요.

```powershell
git clone https://github.com/931njhthe-star/CareerLens-backend.git CareerLens-backend
```

### 1. 백엔드 최초 설정

백엔드 `.env`에 본인의 OpenAI·Supabase 설정을 넣어야 합니다. 비밀키와 DB 접속 정보는 공유하거나 Git에 올리지 마세요. Supabase SQL Editor에서 백엔드의 `migrations\001_backend_runtime.sql`, `migrations\002_latest_evaluation_wins.sql`을 순서대로 적용하세요. 기존 v4 전체 SQL은 재실행하지 마세요. Storage의 비공개 `resume-files` 버킷에 `text/markdown`, `text/plain`, `text/x-markdown` MIME 형식을 허용하고, Supabase Auth에서 이메일·비밀번호 가입을 활성화해야 합니다. 자세한 설명은 [백엔드 실행 안내](https://github.com/931njhthe-star/CareerLens-backend/blob/main/docs/backend-implementation.md)를 참고하세요.

```powershell
cd .\CareerLens-backend
Copy-Item .env.example .env
```

`.env`를 채운 뒤 백엔드 의존성을 설치하고 초기 연결·체크포인트·공고 데이터를 준비합니다.

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m scripts.check_connections
.\.venv\Scripts\python.exe -m scripts.setup_checkpoints
.\.venv\Scripts\python.exe -m scripts.seed_data --limit 100
```

### 2. 백엔드 API와 평가 worker 함께 실행

별도의 PowerShell 터미널을 백엔드 프로젝트 루트(`app`, `workers`, `frontend` 폴더가 있는 위치)에서 열어 실행합니다. API 서버가 평가 worker도 함께 구동하며, 프론트 기본 설정에 맞춰 `5101` 포트를 사용합니다.

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 5101 --loop app.core.asyncio:uvicorn_loop_factory
```

API가 준비됐는지 `http://127.0.0.1:5101/health`에서 확인할 수 있습니다.

### 3. 프론트엔드 실행

새 PowerShell 터미널을 `작업폴더`에서 열어 프론트엔드 폴더로 이동한 뒤 환경 파일과 의존성을 준비합니다. Python 3.12 이상을 사용하면 프론트·백엔드 요구사항을 함께 충족합니다.

```powershell
cd .\CareerLens-frontend
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
```

`.env`의 기본 API 주소는 `http://127.0.0.1:5101`이고 화면 포트는 `5100`입니다. 기본값을 바꿀 필요가 없다면 그대로 둡니다. API 주소에는 `/api` 경로를 덧붙이지 마세요. 그 다음 프론트 서버를 실행합니다.

```powershell
.\.venv\Scripts\python server.py
```

브라우저에서 [http://127.0.0.1:5100](http://127.0.0.1:5100)을 엽니다. 화면만 확인할 때도 프론트 서버가 필요하며, 로그인·저장·실제 API 평가에는 백엔드가 필요합니다. 실제 평가는 API와 worker가 모두 실행 중이어야 합니다. 화면 서버만 실행하면 API 기능은 연결되지 않습니다.

프론트엔드 화면 실행에는 npm 설치나 빌드가 필요하지 않습니다. 흰색·파랑 디자인 시안은 서버 실행 후 `/design-lab`에서 비교할 수 있습니다. 자세한 내용은 [디자인 비교실](docs/product/design-lab.md)을 참고하세요.

직무 목록과 화면 체험용 공고는 기본적으로 프로젝트 옆의 `CareerLens_backup\app\modules\job_postings`에서 UTF-8 Markdown 파일을 읽습니다. 해당 자료가 없으면 이 로컬 공고 목록은 표시되지 않을 수 있습니다. 다른 위치를 사용하려면 프론트 `.env`에 `CAREERLENS_JOB_POSTINGS_DIR`를 지정하세요. DB에 등록되지 않은 원본 공고는 **가상 공고**이며 실제 평가에는 사용할 수 없습니다.

원격 API를 사용하는 경우 `.env`의 `BACKEND_URL`을 `https://api.example.com`처럼 HTTPS origin으로 지정합니다. 원격 평문 HTTP는 지원하지 않습니다.

### 서버 종료 및 문제 확인

각 서버를 실행한 터미널에서 `Ctrl+C`를 누르면 해당 서버가 종료됩니다. 프론트 서버의 `/health`는 `http://127.0.0.1:5100/health`, 백엔드 API의 `/health`는 `http://127.0.0.1:5101/health`입니다. API 설정이 비어 있으면 503 `backend_unconfigured`, 백엔드 연결에 실패하면 502 `backend_unavailable` 오류가 표시됩니다.

```powershell
.\.venv\Scripts\python server.py --port 5200 --backend-url https://api.example.com
```

직접 실행 옵션의 설정 우선순위는 명령행 `--backend-url` → 프로세스 환경변수 → 저장소의 `.env`입니다. `.env`는 단순한 `KEY=value` 형식이고 주석은 별도 줄에 씁니다. `/health`의 `backend_configured`는 주소 설정 유무만 뜻하며 API 연결 성공을 보증하지 않습니다.

## 백엔드·DB·API 연결 조건

[CareerLens Backend](https://github.com/931njhthe-star/CareerLens-backend)의 인증·워크스페이스 API와 연동합니다. 각 팀원은 백엔드 `.env`에 자신의 DB 연결, OAuth, SMTP 및 필요한 API 설정을 넣습니다. 이 프론트엔드는 DB에 직접 접속하지 않습니다.

다른 API 서버를 연결하려면 [OpenAPI 1.7.1 계약](src/shared/api/openapi.json)에 정의한 `/api/v1/auth/session`, 이메일 인증, 쿠키·CSRF, 이력서·희망 직무·사전 분석·워크스페이스, 기존 공고 카탈로그·관심 저장·가상 이력서 요청과 응답을 구현해야 합니다. 주소만 바꾸어 임의의 API와 호환되지는 않습니다. Supabase REST URL이나 프로젝트 URL 자체는 이 계약을 구현한 CareerLens API가 아닙니다. Supabase 등의 DB 연결은 백엔드 설정에서 처리합니다.

현재 연결된 백엔드가 `/auth/session`을 제공하지 않으면 브라우저 API 어댑터가 이를 감지해 기존 화면을 유지하며 백엔드 0.1.0 API로 전환합니다. 계정·이력서·백엔드 등록 공고·평가는 실제 백엔드 API를 사용합니다. 로그인 화면의 **시연용 계정으로 로그인**은 실제 인증 없이 화면 체험용 사용자로 진입하며, 이 계정의 이력서·공고·보고서는 현재 브라우저 탭에만 저장되고 백엔드에 전송되지 않습니다. 시연 계정으로 실행한 평가는 전부 예시 데이터 결과입니다. 실제 에이전트 보고서를 받으려면 실제 백엔드 계정으로 로그인하고 백엔드에 이력서를 저장한 뒤, 백엔드 등록 공고를 선택해야 합니다. 일반 비로그인 게스트 흐름, `CareerLens_backup`에서 읽은 직무·공고 중 백엔드 미등록분, 추가 가상 공고·이력서, 관심 저장과 준비 단계는 화면 체험용이며 실제 DB에 저장되지 않습니다. 게스트 첨부 파일(Markdown 포함)은 백엔드에 전송하거나 분석하지 않습니다. 실제 백엔드 계정 이력서는 UTF-8 Markdown 또는 텍스트 파일만 등록할 수 있습니다.

API 키, DB URL, OAuth client secret, SMTP 비밀번호를 JavaScript, `public/`, 프론트엔드 `.env`에 넣지 마세요. 실제 개인 `.env`, DB 파일, 세션키, 메일, 업로드 데이터는 이 저장소에 포함하지 않습니다. 대시보드 기능도 포함하지 않습니다.

## 인증·쿠키·HTTPS

브라우저는 `/api/v1`을 같은 출처로 호출합니다. `server.py`만 `BACKEND_URL`로 연결하므로 CORS 설정이나 브라우저에 API 키를 노출하는 방식이 필요하지 않습니다. 호환 어댑터는 로그인한 사용자의 Bearer 토큰을 `Authorization` 헤더로 프록시해 백엔드에 전달합니다.

- 백엔드 `PUBLIC_ORIGIN`은 **브라우저에서 연 프론트엔드 주소**와 정확히 같아야 합니다. 예: `http://127.0.0.1:5100`. API 서버 주소와 혼동하지 마세요.
- 프록시는 브라우저의 `Origin`, 세션 쿠키, `X-CSRF-Token`을 전달하고, upstream `Host`는 API 주소로 설정합니다.
- 응답 쿠키의 `Domain` 속성만 제거하여 프론트엔드 호스트에 귀속시킵니다. `Secure`, `HttpOnly`, `SameSite`, `Path`는 유지합니다. 호환 백엔드는 세션 쿠키를 `Path=/`로 설정해야 합니다.
- `Secure` 쿠키를 발급하는 API는 브라우저 쪽도 HTTPS로 제공해야 합니다. 프록시가 `Secure`를 제거해 평문으로 낮추지 않습니다. HTTPS UI는 팀의 TLS reverse proxy를 통해 제공하고 `.env`의 `FRONTEND_PUBLIC_ORIGIN=https://careerlens.example.com`과 백엔드 `PUBLIC_ORIGIN`을 맞춥니다. Python 서버는 루프백에서 실행합니다.
- OAuth 앱에 등록하는 callback은 프론트엔드 주소의 `/api/v1/auth/oauth/{provider}/callback`입니다. 공급자 ID/secret은 백엔드에서 설정합니다. 공급자가 설정되지 않으면 화면의 버튼이 비활성화됩니다.
- API 자신의 origin으로 향하는 `Location`은 프론트엔드의 상대 경로로 변환합니다. 외부 OAuth 공급자 주소는 그대로 전달하고 서버가 대신 따라가지 않습니다.
- HTTPS API 인증서를 정상 검증합니다. 인증서 검증을 끄는 옵션은 없습니다.

상세한 서버 계약과 전달 방법은 [API 연동 문서](docs/api/contract-workflow.md)를 확인하세요.

## 화면 기능

- 이메일 회원가입·로그인·로그아웃, 비밀번호 찾기·재설정, 설정된 OAuth 공급자 연결
- 상단 고정 메뉴 `소개 · 이력서 · 채용공고 · 모의 지원`; 약 2.5초의 문서·렌즈 소개 애니메이션과 건너뛰기, 종료 후 이력서 이동
- 작업 흐름 화면에만 별도의 `이력서 → 희망 직무 → 채용 공고 → 모의지원` 단계 표시; 희망 직무는 2단계, 관련 공고 목록은 3단계, 결과는 4단계
- 로그인 없는 공고 탐색·검색·지역/고용/경력/기술 필터·페이지 이동, 상세·직무 참고 출처
- 계정별 관심 공고 저장/해제, 비공개 공고 직접 입력·수정·삭제
- 비회원도 PDF/DOCX/TXT를 서버에 첨부하고 직무·공개 공고 선택 후 실제 분석까지 진행; 추출 이력서 본문과 보고서는 인증 전 비노출
- 선택한 공고를 서버가 DB에서 조회하여 실제 분석 기준으로 저장; 같은 이력서로 공고별 보고서 생성
- 회원의 PDF/DOCX/TXT 업로드 및 추출 텍스트 확인, 직접 붙여넣기
- 회원의 직무별 가상 이력서 220개 선택, 기존 이력서 교체 확인
- `희망 직무` 독립 페이지에서 직무 선택·직접 입력, 선택적인 점검 요청 작성
- 희망 직무 관련 DB 공고를 왼쪽 목록·오른쪽 상세로 표시; 작은 화면에서는 위아래로 배치
- 공고 상세의 `모의지원 결과 확인` 클릭 즉시 최소 4초의 방사형 사파이어 미세선 눈 모션 표시; 추가 질문 없이 실제 분석 완료 후 회원은 보고서, 비회원은 결과 열람 인증 화면으로 이동
- 비회원 결과 열람은 정보 없는 골격 배경의 흐림·어두운 처리와 포커스를 유지하는 모달로 안내; 로그인·회원가입·직접 파기 제공
- 공고별 근거·강점·보완사항·예상 면접 질문과 실제 평가와 무관한 4축 시연 점수
- 계정의 저장 데이터 불러오기, 이력서 수정·다른 공고로 재분석, 삭제 확인
- 카드 내부 리포트 스크롤, 키보드·모바일 대응, 보고서 브라우저 열람 전용
- 규칙 점수와 분리된 참고 자료 보완 안내, 백엔드에서 제공하는 선택적 AI 제안

실제 저장·인증·추출·분석은 연결된 백엔드가 수행합니다. 화면의 회사·공고 예시는 가상이며 실제 기업에 지원서를 보내는 동작은 없습니다. 분석 점수는 준비도 점검용이며 실제 합격 확률이 아닙니다. 새 모의지원은 선택한 공고의 요구사항을 기준으로 계산합니다. 이전 희망 직무 참고 기준 보고서도 보존합니다. 이번 흐름 변경은 새로운 점수 알고리즘이나 실시간 채용 API 연결을 추가하지 않습니다.

비회원 원본 파일은 디스크에 저장하지 않습니다. 추출 이력서·답변·보고서는 별도 SQL 임시 테이블에 보관하며, 첫 유효 첨부부터 30분이 지나면 접근과 결과 연결을 차단합니다. 파일 교체·분석·로그인으로 시간을 늘리지 않습니다. 실행 중인 서버는 30초마다 및 시작·조회 시 만료 DB 행을 삭제하고, 서버 중지 중 만료된 자료는 재시작 시 삭제합니다. 결과 모달에서도 직접 파기할 수 있습니다. 이는 DB 행 삭제이며 저장 장치나 외부 백업의 복구 불가능한 덮어쓰기를 뜻하지 않습니다.

비회원 응답에는 보고서·점수·추출 본문·제출 답변이 포함되지 않습니다. 로그인·회원가입·OAuth는 비회원 자료 연결을 유지하며, 완료 자료의 claim에 성공하면 해당 계정의 현재 작업 공간을 그 자료로 교체하고 임시 행을 삭제한 뒤 보고서를 보여줍니다. 만료·삭제된 자료는 이력서 재첨부부터 다시 시작해야 합니다. 보고서 PDF 다운로드·인쇄 기능은 제공하지 않으며 인쇄 CSS에서도 내용을 숨깁니다.

눈 모션은 공고 상세의 `모의지원 결과 확인` 클릭 후 표시하며 최소 4초와 실제 API 완료를 기다립니다. 취소하면 선택한 공고 화면으로 돌아갑니다. 연한 배경과 같은 색의 동공 주변에서 사파이어 미세선이 서로 다른 속도로 바깥으로 자랍니다. 완료 후 블루 오빗 입자가 보고서 윤곽을 형성합니다. 12개 하위 평가 항목을 실행마다 다른 선에 배정하고 팝업 게이지를 해당 선과 동기화합니다. 결과 화면의 네 축은 이력서 완성도·직무 적합도·지원 자격 충족도·실무 경쟁력입니다. 현재는 사용자 요청에 따른 프론트엔드 랜덤 시연 점수이며, 실제 평가와 무관하다고 명시합니다. 파란 도형에서 하늘색 변화 예시 도형으로 변하는 동작도 시연입니다. 실제 계산식은 백엔드 담당자가 추후 구현하며 기존 서버 점수와 저장 데이터를 바꾸지 않습니다. [피라미드 안내](docs/product/score-pyramid.md)에 참고 가중치와 편집 위치를 정리했습니다.

제안된 네 축 병렬 평가·Global Critic 아키텍처의 현재 구현과 연결 범위는 [백엔드 아키텍처 인계](docs/product/backend-architecture-handoff.md)에 정리했습니다. 서버 응답 계약이 확정되기 전에는 시연 점수나 화면 게이지를 실제 평가 결과로 바꾸지 않습니다.

## 코드 구조
>>>>>>> Stashed changes

```text
.
├── public/                  # 그대로 제공할 정적 파일
├── src/
│   ├── app/                 # 앱 초기화, 라우팅, 공통 provider
│   ├── pages/               # 기능을 조합하는 화면
│   ├── features/            # 사용자 기능별 코드
│   │   ├── auth/            # 로그인·회원가입·계정
│   │   ├── dashboard/       # 최근 분석·저장 공고·자료 관리
│   │   ├── resumes/         # 이력서 입력·추출 결과 수정·승인
│   │   ├── job-postings/    # 공고 검색·상세·선택·저장
│   │   ├── analysis/        # 분석 진행·요건별 결과·근거·재분석
│   │   ├── preparation/     # 지원 준비 작업·일정·충돌 확인
│   │   └── admin/           # 운영·공고·평가 관리 화면
│   ├── shared/
│   │   ├── api/             # API 클라이언트·요청/응답 타입
│   │   ├── components/      # 공통 UI
│   │   ├── hooks/           # 공통 훅
│   │   ├── lib/             # 공통 유틸리티
│   │   ├── types/           # UI 공통 타입
│   │   └── styles/          # 공통 스타일·디자인 토큰
│   └── assets/              # 소스에서 참조하는 이미지·아이콘
├── scripts/
│   └── sync-api-contract.mjs # 명세 버전·해시 동기화와 검증
├── tests/
│   ├── unit/                # 컴포넌트·훅·유틸리티 단위 테스트
│   └── e2e/                 # 사용자 흐름 테스트
├── docs/
│   ├── architecture/        # 화면 구조·상태 관리·책임 경계
│   ├── api/                 # 프론트엔드의 API 사용·연동 방법
│   ├── product/             # 요구사항·화면·사용자 흐름
│   └── references/          # 프론트엔드 참고자료
├── infra/
│   ├── docker/              # 프론트엔드 컨테이너 구성
│   └── deploy/              # 프론트엔드 빌드·배포 설정
├── .gitignore
└── README.md
```

## 코드 작성 기준

사용자 기능은 `src/features`에서 관리하고, `src/pages`는 기능을 조합해 화면을 구성합니다.
`src/app`은 앱 초기화와 라우팅·공통 provider 구성을 담당합니다. 프레임워크의 파일 기반 라우터를 선택하면 해당 규칙에 맞게 조정합니다.

기능 내부에 필요한 `components`, `api`, `hooks`, `types` 파일·폴더는 구현 때 추가합니다.
한 기능에서만 사용하는 코드는 해당 기능 안에 두고, 여러 기능에서 재사용하는 코드는 `shared`에 둡니다.
기능 간 조합은 `pages`에서 수행해 서로의 내부 구현을 직접 참조하는 범위를 줄입니다.

## 백엔드 연동과 테스트 자료

백엔드가 공개한 버전별 OpenAPI 명세를 받아 `src/shared/api`의 API 클라이언트와 요청·응답 타입을 생성하거나 관리합니다.
명세 버전을 명시해 두 저장소를 독립적으로 관리하고, 백엔드 저장소의 파일을 상대 경로로 직접 참조하지 않습니다.
UI 전용 타입은 `src/shared/types` 또는 해당 기능에 둡니다. 서버의 LLM·DB·외부 API 키는 프론트엔드 설정에 포함하지 않습니다.

테스트용 합성 이력서·가상 채용공고 원문은 백엔드 저장소의 `tests/fixtures/resumes`, `tests/fixtures/job_postings`에서 관리합니다.
프론트엔드 UI 테스트에는 필요한 API 응답 Mock을 사용하고, Mock 저장 폴더는 실제 테스트 구현 시 `tests` 아래에 추가합니다.
실제 사용자의 이력서나 업로드 파일은 Git에 저장하지 않습니다.

문서는 `docs`에, 프론트엔드 실행·배포 설정은 `infra`에 둡니다.
프레임워크·상태 관리·스타일 도구·패키지 매니저와 실행 설정은 아직 추가하지 않았습니다.

## 개발 시작 기준

먼저 이력서 입력·추출 확인·승인, 공고 선택, 분석 진행·근거 상세 화면을 구현합니다.
관리자·준비 일정 화면은 확장 예약 영역이며 필요할 때 구현합니다.
`scripts/sync-api-contract.mjs`는 명시한 명세를 검증해 snapshot과 버전·해시 lock을 저장하고, `--check`는 저장된 계약만 검증합니다.
명령과 전달 절차는 [API 계약 동기화 안내](docs/api/contract-workflow.md)에 정의되어 있습니다.
아직 실제 API 명세·화면·타입 생성 결과·원격 Git 저장소는 없습니다.
