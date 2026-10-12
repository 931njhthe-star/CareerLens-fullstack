| 기능 | Method | Endpoint | 요청 데이터 | 응답 데이터 | 연결 테이블 |
|---|---|---|---|---|---|
| 내 프로필 조회 | GET | `/me` | — | 사용자 프로필 | `profiles` |
| 이력서 업로드 | POST | `/resumes` | 파일, 제목 | 이력서 ID, 파싱 상태 | `resumes`, Storage |
| 이력서 목록 조회 | GET | `/resumes` | 페이지 정보 | 본인 이력서 목록 | `resumes` |
| 이력서 상세 조회 | GET | `/resumes/{resume_id}` | — | 원문, 구조화 데이터, 파싱 상태 | `resumes` |
| 이력서 삭제 | DELETE | `/resumes/{resume_id}` | — | 삭제 완료 | `resumes`, 관련 데이터·Storage |
| 채용공고 목록 조회 | GET | `/jobs` | 검색어, 기업, 경력, 페이지 정보 | 공고 목록 | `job_postings`, `companies` |
| 채용공고 상세 조회 | GET | `/jobs/{job_id}` | — | 담당업무, 필수조건, 우대조건 | `job_postings` |
| 기업 정보 조회 | GET | `/companies/{company_id}` | — | 기업 소개, 산업, 티커 | `companies`, `company_tickers` |
| 기업 재무정보 조회 | GET | `/companies/{company_id}/financials` | 기간 유형 | 수집된 재무정보, 기준일·수집일 | `company_financials` |
| **매칭 평가 시작** | **POST** | **`/evaluations`** | **이력서 ID, 공고 ID** | **실행 ID, 상태** | `evaluation_runs`, `evaluation_input_snapshots` |
| 평가 목록 조회 | GET | `/evaluations` | 상태, 페이지 정보 | 본인 평가 목록 | `evaluation_runs` |
| 평가 상태 조회 | GET | `/evaluations/{run_id}` | — | 상태, 현재 단계, 진행률 | `evaluation_runs` |
| 평가 진행 이벤트 구독 | GET | `/evaluations/{run_id}/events` | 마지막 이벤트 ID | SSE 진행 이벤트 | `progress_events` |
| 평가 취소 | POST | `/evaluations/{run_id}/cancel` | — | 취소 처리 상태 | `evaluation_runs` |
| **매칭 결과 조회** | **GET** | **`/evaluations/{run_id}/result`** | — | **종합점수, 4개 점수, 12개 하위 점수·근거** | `match_results`, `criterion_results`, `evaluation_criteria` |
| 보고서 생성 요청 | POST | `/evaluations/{run_id}/reports` | PDF 생성 여부 | 보고서 ID, 생성 상태 | `analysis_reports` |
| 보고서 조회 | GET | `/reports/{report_id}` | — | 상태, 보고서 내용, 개선 제안 | `analysis_reports` |
| 보고서 PDF 다운로드 | GET | `/reports/{report_id}/download` | — | 임시 다운로드 URL | `analysis_reports`, Storage |