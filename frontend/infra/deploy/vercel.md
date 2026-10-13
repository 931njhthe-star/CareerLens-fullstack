# Vercel 프론트 재배포

이 프론트는 Flask가 화면과 정적 파일을 제공하고 `/api` 요청을 기존 Render 백엔드로 전달합니다. Vercel은 `server.py`를 import해 `app` WSGI 객체를 실행합니다.

## 기존 프로젝트 설정

- Git Repository: `931njhthe-star/CareerLens-fullstack`
- Production Branch: `main`
- Root Directory: `frontend`
- Framework: Flask (자동 감지)
- Build Command, Output Directory, Install Command: 기본값
- `BACKEND_URL`: 현재 Render 백엔드의 HTTPS origin. `/api/v1`이나 `/docs`를 붙이지 않습니다.
- Vercel 기본 도메인은 플랫폼의 `VERCEL_URL`과 `VERCEL_PROJECT_PRODUCTION_URL`로 허용됩니다. 별도 도메인은 `FRONTEND_PUBLIC_ORIGIN`에 HTTPS origin을 설정합니다.

별도 `CareerLens-frontend` 저장소를 연결한다면 Root Directory는 비우고, 동일한 배포 파일들을 그 저장소에도 반영해야 합니다.

변경을 연결된 Git 브랜치에 push한 뒤 새 Deployment가 Ready인지 확인합니다. 수동 배포는 Deployments에서 최신 커밋의 배포를 선택합니다. 배포가 끝나면 해당 배포의 Visit 링크로 접속합니다.

## 확인

프론트 `/health`의 `backend_configured: true`, 화면·JS·공고 목록의 정상 제공을 확인합니다. 로그인과 실제 평가 결과 조회는 Render 백엔드에 연결해 확인해야 합니다.

비회원 로컬 분석 엔진은 이 프론트 배포에 포함되지 않습니다. Vercel의 임시 SQLite 저장소는 영구 보고서 보관용이 아닙니다. 회원 평가와 저장 결과는 기존 Render 백엔드에서 처리합니다.
