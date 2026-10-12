# 프론트엔드 배포 준비

발표·테스트용 **Render 무료 프론트 웹서비스 1개** 설정과 순서는 [render.md](render.md)를 참고하세요. 현재 로컬 준비 상태이며 실제 배포·GitHub 업로드는 하지 않았습니다.

화면은 HTML/CSS/ES module이며, Python 서버가 정적 파일과 동일 출처 API 프록시를 제공합니다. 현재 인증 흐름을 유지하려면 정적 파일만 호스팅하는 대신 이 서버 또는 동등한 /api 프록시를 함께 배포해야 합니다.

```sh
python -m pip install -r requirements.txt
python server.py --host 0.0.0.0 --port 8000
```

`--host` > `FRONTEND_HOST` > 127.0.0.1, `--port` > `FRONTEND_PORT` > `PORT` > 5100 순서입니다. 공개 HTTPS는 배포 환경에서 제공합니다. 로컬 통합 start.bat는 loopback을 유지합니다.

- `BACKEND_URL`: 동일 API 계약을 제공하는 백엔드 origin. 경로·키·비밀번호 없이 설정합니다. 로컬 loopback HTTP 또는 원격 HTTPS를 지원하며 원격 평문 HTTP는 지원하지 않습니다.
- `FRONTEND_PUBLIC_ORIGIN`: 직접 추가한 공개 HTTPS origin. Render 기본 주소는 `RENDER_EXTERNAL_URL`에서 자동으로 읽습니다.
- 현재 FastAPI는 Bearer 인증을 사용합니다. Supabase Site URL·허용 Redirect URLs를 실제 프론트 주소에 맞춥니다. 과거 쿠키 백엔드의 `PUBLIC_ORIGIN`·OAuth 계약은 현재 FastAPI에 적용하지 않습니다.
- 형제 백엔드 폴더가 없는 배포에서는 `data/career-postings.json`의 공개 가상 공고를 제공합니다. 실제 회원 공고·상세·평가 ID는 계속 FastAPI가 기준입니다.

브라우저는 상대 경로 /api를 사용하므로 BACKEND_URL 변경에 화면 코드 재작성·재빌드는 필요하지 않습니다. DB/API 비밀키는 백엔드에서 관리합니다. .env·로그·개인 데이터를 Git에 넣지 않습니다.

상태 확인: 프론트 `/health`는 생존과 API 주소 설정 유무만 확인합니다. 백엔드의 상태 경로는 백엔드 origin의 `/health`이며 `/api/v1/health`가 아닙니다. 실제 로그인·저장·분석은 별도로 검증합니다.

### 비회원 원본 파일의 임시 디스크 기록

기본 `python server.py` 실행은 허용 요청 최대 11MiB, Waitress 메모리 버퍼 임계값 12MiB로 설정되어 원본 업로드를 임시 디스크 파일로 넘기지 않습니다. 별도 WSGI 서버나 외부 리버스 프록시를 추가할 때도 요청 본문 디스크 버퍼링을 끄거나 허용 크기보다 높은 메모리 임계값을 설정해야 합니다. 이 프록시는 파일 본문·API 응답을 로그에 기록하지 않습니다.
