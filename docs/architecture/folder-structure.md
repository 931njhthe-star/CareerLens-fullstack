# 백엔드 폴더 설계와 자료 대응

참고 자료는 `채용공고_맞춤형_이력서_검증_에이전트.zip`의 기획·모델·아키텍처 문서와, 입력 보안부터 최종 출력 검증까지 설명한 54단계 텍스트 흐름도입니다.
프론트엔드와 백엔드는 각각 독립 Git 저장소로 관리합니다. 이 문서의 경로는 백엔드 저장소 루트를 기준으로 합니다.

## 상세 흐름도 대응

각 단계마다 폴더를 만들지 않고 같은 책임을 수행하는 단계를 모았습니다.
아래는 구현 예정 위치이며 실제 코드나 도구 연결은 없습니다.

| 흐름도 단계 | 주요 위치 |
| --- | --- |
| 1 입력 검사·개인정보 분리 | `app/core`, `app/modules/resumes` |
| 2–5-1 이력서·공고 파싱, 스키마 검사, 재파싱 | `modules/resumes/parsing`, `modules/job_postings`, `integrations/document_parsers` |
| 6–7 정규화, 경력·기술 사용기간·최근성 | `modules/resumes/normalization` |
| 8–13 요구사항 추출·정규화·중복 제거·분류·가중치 | `modules/job_postings`, `modules/analysis/scoring` |
| 14–15, 30–31 요건 순회·현재 상태·결과 누적 | `agent/graphs`, `agent/state`, `modules/analysis` |
| 16–22 정확·의미 매칭, 근거 검색·정렬·질의 수정 | `modules/analysis/matching`, `retrieval`, `integrations/embeddings` |
| 23–27 근거·숙련도·기여도·기간·성과 판정 | `modules/analysis/matching`, `agent/nodes`, `integrations/llm` |
| 28–29, 39–46 점수·신뢰도·필수 규칙 | `modules/analysis/scoring`, `modules/analysis/validation` |
| 32–38 누락·교차 모순 검사, 부분 재실행 | `modules/analysis/validation`, `agent/graphs`, `agent/nodes` |
| 47–52 최종 비평·오류 라우팅·재시도 제한·보류 | `modules/analysis/validation`, `agent/graphs`, `agent/state` |
| 53–54 보고서·출력 일관성 | `modules/analysis/reporting`, `modules/analysis/validation`, `contracts` |

표의 `modules`, `agent`, `retrieval`, `integrations`는 모두 `app` 하위입니다.
LLM 판단과 결정적 계산·검증을 분리할 수 있는 경계를 마련했습니다.

## 기획 문서의 추가 기능

- 인증·user/admin 역할: `app/modules/auth`.
- 최근 분석·저장 공고·자료 관리: `app/modules/analysis`, `app/modules/job_postings`, `app/modules/resumes`.
- 준비 작업·일정 충돌·재계획: `app/modules/preparation`과 `app/agent/graphs`. 외부 일정 제공자는 `app/integrations/calendar`에서 교체.
- 선택적 기업 기본정보: `app/integrations/company_info`.
- 운영·평가 관리: `app/modules/admin`, `evaluations`.

해당 기능의 화면·사용자 상호작용·화면 설계는 프론트엔드 저장소에서 관리합니다.
백엔드의 기능·정책 문서는 `docs/product`, API 설명은 `docs/api`, 기획·모델 참고자료는 `docs/references`에 둡니다.

## 통신 계약과 데이터

`contracts/openapi`는 백엔드가 관리·공개하는 버전별 API 명세 자리이고, `contracts/schemas`는 교환 데이터 JSON Schema 자리입니다.
프론트엔드는 공개된 명세를 받아 API 클라이언트·타입을 관리하며 백엔드의 로컬 파일 경로에 의존하지 않습니다.

| 위치 | 데이터 역할 |
| --- | --- |
| `tests/fixtures/resumes` | 파싱·매칭 테스트용 합성 이력서 원문 |
| `tests/fixtures/job_postings` | 요건 추출·매칭 테스트용 가상 공고 원문 |
| `tests/fixtures`의 기타 하위 영역 | 외부 도구 응답·오류 사례·기대 결과 |
| `data/knowledge` | 기술 분류체계·판정 정책과 버전별 지식 자료 |
| `evaluations/datasets` | 평가 사례·정답 label·fixture 참조 |
| `evaluations/metrics` | 근거 정확도·판정 일관성·수정 전후 품질 계산 |

테스트와 평가가 같은 fixture 원문을 참조합니다.
실제 업로드·개인 자료는 `data/private`, `data/uploads`, `.runtime`처럼 저장소의 `.gitignore`가 제외하는 위치에서 관리합니다.

## 확장 기준

새 업무 기능은 `app/modules`에 추가합니다.
새 제공자는 `app/integrations` 또는 `app/infrastructure` 어댑터로 추가합니다.
새 분석 단계는 기존 모듈 규칙을 호출하는 `app/agent/nodes`와 그래프 분기로 연결합니다.
실행량이 늘면 `workers`에 작업 큐 진입점을 추가하되 동일한 업무 서비스를 재사용합니다.
API 호환성이 달라지면 `app/api/v2`와 해당 버전의 계약을 추가합니다.

ZIP은 P0의 요건별 근거 상태를 중심으로 설계하고, 텍스트 흐름도는 STRONG/PARTIAL/TRANSFERABLE/NONE과 종합점수를 제안합니다.
`app/modules/analysis/scoring`은 이 확장을 수용하는 예약 공간이며 점수 공개 정책·상태 대응은 확정하지 않았습니다.
LLM 제공자, 임베딩 모델, DB, 배포 환경과 HTTP 프레임워크는 후속 구현에서 선택합니다.

## 확정한 실행·개발 규칙

API/worker의 진입점은 `app/application`을 호출합니다. application이 그래프를 실행하고 외부 구현을 주입합니다.
agent와 modules는 application을 역참조하지 않습니다. 상세 방향과 구현 우선순위는 [의존 규칙](dependencies.md)을 따릅니다.
명세 전달은 [API 계약 절차](../api/contract-workflow.md), 사례 연결은 [평가 데이터 기준](../../evaluations/datasets/README.md)을 따릅니다.
두 폴더는 각각 main 브랜치의 독립 로컬 Git 저장소로 초기화되어 있습니다.
