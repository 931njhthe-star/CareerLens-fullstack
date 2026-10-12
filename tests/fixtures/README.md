# 테스트 입력 자료

백엔드의 파싱·요건 추출·매칭 테스트와 에이전트 평가가 같은 원문을 참조하는 위치입니다.

```text
tests/fixtures/
├── resumes/       # 테스트용 합성 이력서: PDF, DOCX, TXT, JSON 등
├── job_postings/  # 테스트용 가상 채용공고: TXT, JSON 등
└── README.md
```

현재 샘플 이력서와 공고는 없습니다. 폴더가 존재하거나 빈 예제 명세의 검증이 성공했다고 해서 분석 테스트가 통과한 것은 아닙니다.

## 사례 연결 규칙

이력서에는 `resume-0001`, 공고에는 `job-0001`, 이 둘을 평가하는 사례에는 `case-0001`처럼 고정 ID를 붙입니다. ID는 소문자 영문·숫자와 단어 사이의 하이픈만 사용하고, 원문 수정이나 정렬 변경 때문에 다시 부여하지 않습니다. 같은 입력을 여러 사례에서 재사용할 수 있으며 `case_id`는 명세 전체에서 고유해야 합니다.

원문은 이 폴더에 한 번만 보관하고, 사례와 정답은 `evaluations/datasets`에서 연결합니다. 실제 자료를 추가한 뒤 `evaluations/datasets/cases.json`을 작성합니다.

| 필드 | 의미 | 경로 또는 ID 예시 |
|---|---|---|
| `case_id` | 이력서·공고·정답을 연결하는 사례 ID | `case-0001` |
| `resume_id` | 이력서의 고정 ID | `resume-0001` |
| `resume_path` | 백엔드 루트 기준 이력서 원문 경로 | `tests/fixtures/resumes/resume-0001.txt` |
| `job_id` | 채용공고의 고정 ID | `job-0001` |
| `job_path` | 백엔드 루트 기준 공고 원문 경로 | `tests/fixtures/job_postings/job-0001.txt` |
| `expected_path` | 백엔드 루트 기준 정답 JSON 경로 | `evaluations/datasets/case-0001.expected.json` |

표의 경로는 작성 형식의 예시이며 해당 파일은 아직 없습니다. 절대 경로, `..`가 포함된 경로, 심볼릭 링크·정션을 통한 외부 파일 참조는 사용하지 않습니다. 정답에는 사례 ID와 함께 기대 판정·근거 위치·요건별 기대값을 기록합니다. 상세 명세와 검사 방법은 [평가 자료 안내](../../evaluations/datasets/README.md)를 참고합니다.

## 자료의 역할

- `tests/fixtures`: 개발·테스트·평가용 원문과 도구 응답. 운영 서비스가 런타임 데이터로 읽지 않습니다.
- `evaluations/datasets`: 사례 명세와 정답. 원문을 복사하지 않고 fixture 경로를 참조합니다.
- `data/knowledge`: 서비스가 사용하는 기술 분류와 판정 정책. 운영 DB 초기화용 seed도 테스트 fixture와 분리하여 `data` 아래에서 관리합니다.
- 프론트엔드 UI 테스트: 자신의 저장소에 필요한 API 응답 Mock을 보관합니다.

Git에는 합성·비식별 테스트 자료를 포함합니다. 실제 업로드·개인 자료는 `data/uploads`, `data/private`, `.runtime` 등 Git에서 제외하는 위치를 사용합니다.
