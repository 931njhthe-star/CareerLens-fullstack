# 평가 사례와 정답

테스트 원문은 `tests/fixtures`에 보관하고 이 폴더에는 원문을 참조하는 사례 명세와 정답 JSON을 둡니다. 같은 입력을 통합 테스트와 에이전트 평가에서 재사용합니다.

현재 실제 원문·정답·`cases.json`은 없습니다. `cases.example.json`은 `schema_version: 1`, `cases: []`인 빈 구조 예제입니다. 자료를 준비한 뒤 이를 복사하여 `cases.json`을 만들고 사례를 등록합니다. 빈 예제의 구조 검증은 분석 동작이나 정확도를 검증하지 않습니다.

## 사례 명세

최상위 객체는 정수 `schema_version: 1`과 배열 `cases`를 가집니다. `cases`의 각 항목은 다음 문자열 필드를 모두 가집니다.

| 필드 | 규칙 |
|---|---|
| `case_id` | 고정 사례 ID. 전체 명세에서 고유 |
| `resume_id` | 고정 이력서 ID. 같은 원문을 재사용할 때 유지 |
| `resume_path` | `tests/fixtures/resumes/` 하위의 기존 원문 파일 |
| `job_id` | 고정 채용공고 ID. 같은 원문을 재사용할 때 유지 |
| `job_path` | `tests/fixtures/job_postings/` 하위의 기존 원문 파일 |
| `expected_path` | `evaluations/datasets/` 하위의 기존 `.json` 정답 파일 |

ID에는 소문자 영문·숫자와 단어 사이의 하이픈만 사용합니다. 경로는 백엔드 저장소 루트 기준이며 `/`로 작성합니다. 절대 경로, 드라이브 경로, `..`, 심볼릭 링크·정션은 허용하지 않습니다.

아래 항목은 작성법만 보여 줍니다. 해당 원문과 정답 파일은 아직 없습니다.

```json
{
  "case_id": "case-0001",
  "resume_id": "resume-0001",
  "resume_path": "tests/fixtures/resumes/resume-0001.txt",
  "job_id": "job-0001",
  "job_path": "tests/fixtures/job_postings/job-0001.txt",
  "expected_path": "evaluations/datasets/case-0001.expected.json"
}
```

## 정답 파일

정답은 `schema_version: 1`, 명세와 일치하는 `case_id`, 객체 타입의 `expected`를 가진 JSON 객체입니다. `expected`에는 실제 구현의 출력 스키마에 맞춰 요건별 기대 판정, 기대 근거 위치, 보완 질문 등을 기록합니다. 현재 업무 출력 스키마는 확정하지 않았으므로 검사 스크립트는 정답의 외곽 형식만 검사합니다.

```json
{
  "schema_version": 1,
  "case_id": "case-0001",
  "expected": {}
}
```

위 빈 `expected`는 외곽 구조 설명용입니다. 실제 평가를 실행하기 전에 기대값을 채워야 합니다. 사례 명세의 경로 연결을 검사하는 것과 분석 결과를 정답에 비교하는 것은 별도의 작업입니다.

## 구조와 참조 검사

PowerShell에서 어느 작업 디렉터리든 다음과 같이 스크립트 경로를 지정하여 실행할 수 있습니다. `-Manifest`는 항상 백엔드 루트 기준 상대 경로로 해석합니다.

```powershell
# 백엔드 루트에서 실제 자료 검사. cases.json이 없으면 실패합니다.
./scripts/validate-fixtures.ps1

# 현재 제공되는 빈 예제: 0건인 구조만 검사합니다.
./scripts/validate-fixtures.ps1 -Manifest evaluations/datasets/cases.example.json
```

검사는 JSON 객체·필드 타입·버전, 사례 ID 중복, 파일 존재, 허용된 폴더 경계, 정답 JSON 형식을 확인합니다. 경로는 실제 절대 경로로 정규화한 뒤 폴더 경계를 확인하고, 리파스 포인트를 통한 우회도 차단합니다. 성공 시 종료 코드 `0`, 오류 시 `1`을 반환합니다. 빈 `cases`는 성공 코드와 함께 `0 cases; structure only`를 출력하므로 데이터가 있는 검사와 구별할 수 있습니다.

이 자료는 개발·평가 전용입니다. 운영 seed와 서비스 지식 자료는 `data` 아래에 관리하며, 테스트 fixture를 운영 데이터 원천으로 사용하지 않습니다.
