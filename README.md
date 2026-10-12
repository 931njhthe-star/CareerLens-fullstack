# 채용공고 맞춤형 이력서 검증 에이전트 — Backend

이 폴더는 main 브랜치의 독립 백엔드 Git 저장소입니다.
API, 업무 규칙, LangGraph 분석 엔진, 테스트 데이터, 설계 문서와 배포 설정을 이 저장소 안에서 관리합니다.
FastAPI와 LangGraph 기반 매칭 평가 백엔드를 구현했습니다. 실행·API·채점 정책은 [백엔드 실행 안내](docs/backend-implementation.md)를 참고하세요.

## 전체 구조

```text
.
├── app/
│   ├── application/          # 업무 흐름 조정·그래프 실행·외부 구현 조립
│   ├── api/v1/routes/         # 버전별 HTTP 진입점
│   ├── core/                 # 설정, 공통 예외, 보안, 로깅
│   ├── modules/              # 기능별 업무 모델·서비스·저장소 인터페이스
│   │   ├── auth/             # 인증, 사용자, 역할·접근 권한
│   │   ├── resumes/
│   │   │   ├── parsing/       # 구조화, 원문 위치, 재파싱
│   │   │   └── normalization/ # 기술명 정규화, 기간·최근성 계산
│   │   ├── job_postings/      # 공고·요건, 정규화·분류, 저장 공고
│   │   ├── analysis/
│   │   │   ├── matching/      # 요건과 근거 연결·판정
│   │   │   ├── scoring/       # 점수·신뢰도 계산 확장 영역
│   │   │   ├── validation/    # 스키마·출처·일관성·정책 검증
│   │   │   └── reporting/     # 결과·근거·보완 질문 구성
│   │   ├── preparation/       # 준비 작업, 가용 시간·일정 규칙
│   │   └── admin/             # 운영·공고 관리 유스케이스
│   ├── agent/                # 단일 LangGraph 에이전트
│   │   ├── graphs/           # 분석·준비 일정 그래프, 조건 분기
│   │   ├── nodes/            # 단계별 실행과 업무 로직 호출
│   │   ├── tools/            # 허용 도구 등록·입출력 경계
│   │   ├── prompts/          # 버전별 프롬프트
│   │   └── state/            # 실행 상태, 재시도·수정 이력
│   ├── retrieval/
│   │   ├── indexing/         # 청크, 인덱스 구성
│   │   ├── search/           # 키워드·벡터 검색, 질의 재구성
│   │   └── reranking/        # 후보 근거 정렬
│   ├── integrations/
│   │   ├── llm/
│   │   ├── embeddings/
│   │   ├── document_parsers/ # PDF·DOCX 추출 라이브러리 어댑터
│   │   ├── company_info/     # 선택적 OpenDART 등 기업 정보
│   │   └── calendar/         # Mock 또는 추후 일정 제공자 연동
│   └── infrastructure/
│       ├── database/         # DB 연결·저장소·벡터 저장소 구현
│       └── storage/          # 임시 파일·객체 저장소, 보존·삭제
├── contracts/
│   ├── openapi/              # 백엔드가 관리·공개하는 버전별 API 명세
│   └── schemas/              # 요청·응답·교환 데이터 JSON Schema
├── data/
│   └── knowledge/
│       ├── taxonomy/         # 기술·직무 분류체계
│       └── policies/         # 판정·매칭 정책 자료
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/             # 테스트 원문·응답·오류 사례
│       ├── resumes/          # 테스트용 합성 이력서
│       └── job_postings/     # 테스트용 가상 채용공고
├── evaluations/
│   ├── datasets/             # 사례 연결 예제·정답·fixture 참조
│   └── metrics/              # 근거 정확도·판정 일관성 등
├── workers/                  # 추후 비동기 작업 진입점
├── migrations/               # 추후 DB 스키마 변경
├── scripts/
│   ├── export-api-contract.ps1 # 버전별 API 명세 릴리스 산출물
│   └── validate-fixtures.ps1   # 사례 ID·입력·정답 파일 참조 검증
├── docs/
│   ├── architecture/         # 구조·그래프·책임 경계
│   ├── api/                  # API 사용·버전 관리 안내
│   ├── product/              # 백엔드 기능·업무 정책
│   └── references/           # 기획·모델·아키텍처 참고자료
├── infra/
│   ├── docker/               # 백엔드·worker 컨테이너 설정
│   └── deploy/               # API·DB·worker 배포 설정
├── .gitignore
└── README.md
```

## 책임 경계

API 라우트와 worker는 application 유스케이스를 호출합니다. application은 모듈 서비스와 그래프 실행을 조합합니다.
그래프 노드는 도메인 규칙·검색·어댑터를 조합하며 application을 참조하지 않습니다. modules의 규칙은 agent·application·외부 구현을 참조하지 않습니다.
인증·CRUD·저장 업무는 일반 서비스에서 관리하고, LangGraph는 분석·검증·수정·일정 재계획을 담당합니다.

모듈 내부의 `models.py`, `schemas.py`, `service.py`, `repository.py` 등은 구현에 필요한 만큼 추가합니다.
저장소 인터페이스는 해당 모듈에, DB에 종속되는 구현은 `app/infrastructure/database`에 두는 방향입니다.

`resumes/parsing`은 필드 구조화·근거 위치·재파싱을, `integrations/document_parsers`는 파일 형식별 텍스트 추출 연결을 담당합니다.
`analysis/validation`은 결정적 검증 규칙을, `agent/nodes`는 검증 호출과 재실행 경로를 담당합니다.
`analysis/scoring`은 12개 초기 채점 기준과 가중 기하평균을 구현합니다. 미확인 항목 및 미해결 검증 문제는 종합점수 보류로 표시합니다.

## API 계약과 저장소 독립성

백엔드 API 스키마를 원본으로 관리합니다. `scripts/export-api-contract.ps1`은 생성된 OpenAPI JSON을 버전·해시와 함께 `contracts/openapi/v<version>`에 내보내고 동일 버전 덮어쓰기를 막습니다.
프론트엔드는 공개된 버전별 명세를 받아 자신의 API 클라이언트·타입을 관리합니다.
실행·빌드·테스트에 다른 저장소의 로컬 폴더가 필요하지 않도록 구성합니다.
의존성은 `requirements.txt`와 `requirements.lock.txt`, 환경변수는 루트 `.env`에서 관리합니다. CI와 배포 구성은 후속 작업입니다.

## 테스트 데이터

테스트용 이력서는 `tests/fixtures/resumes`, 테스트용 채용공고는 `tests/fixtures/job_postings`에 둡니다.
파싱·요건 추출·매칭 통합 테스트와 에이전트 평가가 같은 원문을 재사용할 수 있도록 입력 데이터를 한곳에서 관리합니다.
`evaluations/datasets`에는 평가 사례·정답과 fixture 참조를 두고 원문을 중복 저장하지 않습니다.
외부 도구 응답과 오류 사례도 필요할 때 `tests/fixtures` 아래에 구분해 추가합니다.

이력서·공고 폴더에는 아직 샘플 파일이 없습니다. `evaluations/datasets/cases.example.json`은 비어 있는 사례 연결 형식이고, `scripts/validate-fixtures.ps1`은 사례 ID·안전한 파일 참조·정답 JSON을 검증합니다.
버전 관리할 이력서는 합성·비식별 자료를 사용합니다. 실제 업로드와 개인 자료는 `data/uploads`, `data/private`, `.runtime` 등의 Git 제외 위치에서 관리합니다.
기술 분류·판정 정책처럼 서비스가 참조하는 지식 자료는 `data/knowledge`에 둡니다.

Python/FastAPI/Pydantic, PostgreSQL/pgvector, OpenAI GPT-6 Luna, LangGraph 및 DB 큐 기반 Evaluation Worker를 사용합니다. Worker는 FastAPI lifespan에서 함께 실행됩니다. Render 배포는 [백엔드 실행 안내](docs/backend-implementation.md)를 참고합니다.
상세 흐름도 대응은 [구조 설계 문서](docs/architecture/folder-structure.md), fixture 사용 기준은 [테스트 데이터 안내](tests/fixtures/README.md)를 참고합니다.

## 개발 시작 기준

먼저 이력서 입력·확인·승인, 공고 선택, 분석 실행, 근거 확인 흐름을 구현합니다.
현재 구현은 Markdown 업로드, 인증, 공고 선택, Yahoo Finance 기업 맥락, 4개 영역 매칭 평가, worker, 진행률, 종합점수 및 Markdown 보고서입니다. 관리자·준비 일정·외부 일정은 확장 예약 영역입니다.
의존 방향과 초기/확장 범위는 [의존 규칙](docs/architecture/dependencies.md), 명세 내보내기는 [API 계약 절차](docs/api/contract-workflow.md)에 정의되어 있습니다.
업무 API와 개발용 OpenAPI 계약을 구현했습니다. 원격 저장소·태그·릴리스는 아직 없습니다.

