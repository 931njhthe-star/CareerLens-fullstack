# CareerLens 발표·테스트용 Render 배포

> 2026-10-13 변경: 이 문서는 프론트 화면만 띄우는 이전 발표용 구성입니다. 비회원 실제 분석·결과 보관·회원 전용 운영 화면을 포함한 전체 배포는 [production.md](production.md)를 사용하세요. 이용 흐름은 같은 브라우저의 작업 창 하나와 관찰 창 하나를 고정 연결하며, 여러 사용자를 수집하는 중앙 추적은 사용하지 않습니다. 아래의 무료 프론트 단독 구성으로 전체 기능이 동작한다고 간주하면 안 됩니다. 대시보드·이용 흐름은 모든 가입 회원에게 열리며 관리자 권한은 필요하지 않습니다.

준비일: 2026-10-12 KST. **로컬 설정 준비이며 Render 자원 생성·실제 배포·GitHub 업로드는 아직 하지 않았습니다.**

## 범위와 준비한 파일

Flask + Waitress 프론트 웹서비스 **1개**만 무료 플랜에 배치합니다. 기존 화면, 눈·로고·피라미드 모션, 마이페이지와 API 연결 방식을 유지합니다. 백엔드·평가 작업자·DB는 생성하지 않습니다.

```text
브라우저 → Render 프론트(Flask + Waitress)
                    → BACKEND_URL의 HTTPS FastAPI
                                      → Supabase / OpenAI
                      별도로 실행하는 평가 작업자 → 분석·저장
```

| 파일 | 역할 |
|---|---|
| `render.yaml` | 무료 프론트 Web Service 1개, Singapore, 수동 배포, `/health` |
| `.python-version` | Python 3.12 계열의 Render 지원 최신 패치 사용 |
| `requirements.txt` | 기존 프론트 전용 의존성 |
| `server.py` | Render 호스트 자동 허용, 기존 프록시·업로드·파일 제공 |
| `data/career-postings.json` | 공개 가상 공고 100개·11개 분류 스냅샷 |
| `scripts/export-job-catalog.py` | 공개 공고 변경 후 로컬 재생성 |
| `tests/test_render_deployment.py` | 독립 배포·호스트·프록시 검사 |

공고 스냅샷은 백엔드를 수정하지 않고 공개 원본만 읽어서 만들었습니다. 개인 이력서·DB·키를 포함하지 않습니다. 로그인한 사용자의 공고·상세·평가 ID는 실제 API가 기준이며 이 자료가 DB에 자동 등록되지는 않습니다.

## 나중에 실제 배포할 순서

1. 사용자의 GitHub 업로드 요청 후, 최신 프론트 변경을 검토해 **CareerLens-frontend 저장소의 `sub-main/withandwithout` 브랜치**에 올립니다. 이번 설정 외에도 로컬 미게시 변경이 있으므로 마이페이지·보고서 등 필요한 최신 파일을 누락하지 않아야 합니다.
2. 백엔드 담당자에게 **외부 접속 가능한 FastAPI HTTPS origin**을 받습니다. 예시는 `https://api.example.com`이며 실제 주소를 입력합니다. Supabase URL, localhost, `/docs`나 `/api/v1`이 붙은 주소를 넣지 않습니다.
3. Render **New → Blueprint**에서 프론트 저장소와 위 브랜치를 선택합니다. 파일은 루트 `render.yaml`이며 Root Directory는 비워 둡니다.
4. 생성 내용이 **Web Service 1개 / Free / Singapore**인지 확인합니다. DB·worker·유료 서비스는 추가하지 않습니다. 이름은 필요하면 생성 전에 변경합니다.
5. 요청받는 `BACKEND_URL`을 입력하고 생성하면 최초 배포가 시작됩니다. `autoDeployTrigger: off`는 이후 Git 커밋에 따른 자동 배포를 끄며 최초 생성을 막지는 않습니다.
6. 실제 `https://...onrender.com` 주소를 기록합니다. 기본 주소는 앱이 자동 허용하므로 `FRONTEND_PUBLIC_ORIGIN` 입력이 불필요합니다.
7. Supabase 관리자가 **Site URL·허용 Redirect URLs를 실제 프론트 주소로 설정**합니다. 현재 가입 API는 별도 `emailRedirectTo`를 보내지 않으므로 Site URL이 특히 중요합니다. 필요한 기존 로컬 주소는 허용 목록에 유지하고, 새 인증 메일로 복귀를 확인합니다.
8. 아래 체크리스트를 수행합니다. 이후 갱신은 Render **Manual Deploy**에서 필요한 때만 실행합니다.

이 파일을 준비한 것만으로 서비스나 비용이 발생하지 않습니다. 실제 서버 생성은 향후 배포 요청 때 진행합니다.

## 수동 Web Service로 만드는 경우

| 항목 | 값 |
|---|---|
| Repository / Branch | CareerLens-frontend / sub-main/withandwithout |
| Root Directory | 비워 둠 |
| Runtime / Region / Plan | Python 3 / Singapore / Free |
| Build Command | `python -m pip install -r requirements.txt` |
| Start Command | `python server.py --host 0.0.0.0 --port $PORT` |
| Health Check Path | `/health` |
| Auto-Deploy | Off |
| BACKEND_URL | 실제 HTTPS API origin |
| PYTHONUNBUFFERED | `1` |

Render는 Linux입니다. `start.bat`이나 상위 `run.py`를 실행하지 않습니다. 위 명령이 Render의 `PORT`를 사용합니다. `.python-version`으로 Python을 지정하므로 `PYTHON_VERSION`을 따로 넣지 않아도 됩니다.

## 환경변수

| 설정 | 처리 |
|---|---|
| `BACKEND_URL` | 실제 기능에 필수. 배포된 FastAPI HTTPS origin |
| `RENDER`, `RENDER_EXTERNAL_URL`, `PORT` | 플랫폼이 제공. 테스트 값으로 덮어쓰지 않음 |
| `FRONTEND_PUBLIC_ORIGIN` | 사용자 지정 도메인을 추가할 때만 정확한 HTTPS origin 입력 |
| `CAREERLENS_JOB_POSTINGS_DIR` | 비워 두거나 제거. Windows 로컬 경로를 넣지 않음 |
| OpenAI·Supabase service role·DB 비밀 | 프론트에는 넣지 않음. 백엔드 담당자가 관리 |

브라우저는 같은 출처 `/api/v1/...`를 호출하고 프론트 서버가 API로 중계합니다. 다른 출처 API 직접 호출 방식으로 바꾸지 않았습니다. 백엔드의 외부 HTTPS 접근과 기존 인증·API 계약은 정상이어야 합니다.

화면만 먼저 확인할 경우 수동 Web Service 생성에서 `BACKEND_URL`을 생략할 수 있습니다. 소개·공개 가상 공고·합성 모션 미리보기는 확인할 수 있지만 로그인·실제 분석은 API 미설정 오류를 표시합니다. 실제 평가를 데모 결과로 대체하지 않습니다.

## 발표 전 확인

- [ ] 프론트 `/health`: `status: ok`, 실제 API 연결 설정 시 `backend_configured: true`. 이 값만으로 API·DB·worker·모델 동작을 보증하지 않음.
- [ ] 첫 화면·CSS·로고·눈·피라미드 모듈이 404 없이 열림.
- [ ] 로그인 전 공개 공고·분류가 보이고 로그인 후 실제 서버 등록 공고가 표시됨.
- [ ] 새 이메일 인증 링크가 배포한 프론트로 복귀함.
- [ ] 로그인·로그아웃·재로그인과 마이페이지 확인.
- [ ] 작은 테스트 `.md` 업로드 및 잘못된 파일 안내 확인.
- [ ] 팀이 승인한 테스트 계정·자료로 실제 분석 1건 수행. AI 사용량이 발생할 수 있어 자동 준비 검사에는 포함하지 않음.
- [ ] 실제 진행률, 피라미드와 표의 같은 점수, 대상 공고, 자동 저장 보고서 재조회 확인.
- [ ] 일반 회원의 마이페이지에서 대시보드·이용 흐름이 열리고 비회원 접근은 차단됨. 대시보드는 본인 계정 실행 범위이며, 전체 계정 통계·원본 백엔드 보고서 삭제 등 기존 미지원 API가 배포로 새로 생긴 것처럼 안내하지 않음.
- [ ] 다른 PC·휴대전화에서 같은 배포 주소로 접속 확인.

현재 프론트 준비는 별도 API·worker 배포를 대신하지 않습니다. 백엔드 담당자는 DB·체크포인트·공고 등록·모델 설정·작업자 실행을 준비합니다.

## 무료 운영과 절전

Free 웹서비스는 요청이 없으면 절전될 수 있습니다. 발표 직전에 프론트와 백엔드를 열어 초기 기동을 확인합니다. 절전을 막는 지속 자동 호출은 추가하지 않았습니다. 프론트가 켜져도 별도 백엔드가 절전 중이면 초기 API 요청은 실패할 수 있습니다.

Render 실행 시간·전송량·빌드 한도는 AWS·Supabase·OpenAI와 별도입니다. 이 Blueprint에는 자동 배포·자동 미리보기·DB·worker·영구 디스크가 없습니다. 발표 종료 후 서비스 유지·중지는 팀이 결정합니다.

## 검증과 문제 확인

프론트 의존성을 설치한 환경에서 `python -m unittest discover -s tests -p 'test*.py'`로 확인합니다. 준비 과정에서 서버 테스트 29개를 통과했습니다. 백엔드 폴더 없는 복사본, Render 호스트, API 주소 오류, 공고 제공, 인증 헤더 중계와 오류 반환을 검사하며 유료 모델·원격 DB를 호출하지 않습니다.

추가로 `.env`와 백엔드 폴더가 없는 별도 복사본에서 실제 Waitress를 잠시 실행해 HTTP 상태·화면·모션 파일·공고 100개·분류 11개를 확인했습니다. 테스트 서버는 확인 후 종료했습니다. Blueprint는 YAML 문법과 무료 프론트 서비스 1개·수동 배포 설정을 로컬에서 확인했으며 Render 계정의 원격 검증·생성 API는 호출하지 않았습니다.

**Render 실제 빌드·Linux 실행·실제 HTTPS API·이메일 인증은 자원 생성 후 확인해야 합니다.** 로컬 준비와 실제 배포 완료는 구분합니다.

| 현상 | 확인할 내용 |
|---|---|
| 시작 시 localhost 오류 | BACKEND_URL을 실제 HTTPS API로 변경 |
| 400 Invalid Host | Render 기본 환경변수, 추가 도메인의 FRONTEND_PUBLIC_ORIGIN |
| 공고 자료 503 | 스냅샷 게시 누락, Windows 경로 설정 잔존 |
| API 503 backend_unconfigured | BACKEND_URL 미설정 |
| API 502 backend_unavailable | 주소·백엔드 기동·인증서·방화벽 |
| 인증 메일이 localhost:3000으로 이동 | Supabase Site URL·Redirect URLs 수정 후 새 링크 사용 |
| 분석이 대기 상태에서 멈춤 | 백엔드 worker·DB·모델 설정 |
| 새 화면이 배포에 없음 | 미게시 로컬 파일 또는 수동 재배포 누락 |

공식 기준: [Blueprint](https://render.com/docs/blueprint-spec), [Python 버전](https://render.com/docs/python-version), [플랫폼 환경변수](https://render.com/docs/environment-variables), [상태 확인](https://render.com/docs/health-checks), [무료 서비스](https://render.com/docs/free).
