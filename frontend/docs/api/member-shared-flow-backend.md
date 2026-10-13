> **이전 버전 안내 — 현재 적용 금지.** v2026.10.13-0719는 이 공용 흐름 패치를 취소하고 백엔드 3863f6e 기준본을 유지합니다. Redis·전체 사용자 수집 대신 프론트 작업 창별 고정 관찰을 사용합니다. 아래 내용은 0131 버전의 역사 기록입니다.

# 회원 대시보드·공유 이용 흐름 백엔드 적용

2026-10-13 KST. 프론트엔드만 업데이트하면 서버 전체 이용 흐름이 완성되지 않습니다.
첨부 `member-shared-flow-backend.patch`는 백엔드 기준 커밋
`3863f6eb65775a6483d35ca02b4030c876cfa16c`에 적용하는 소스 패치입니다.
백엔드 커밋·업로드·운영 DB 변경을 대신 수행하는 파일이 아닙니다.

두 저장소를 같은 상위 폴더의 `CareerLens-frontend`, `CareerLens-backend`로 둡니다.
백엔드 폴더에서 먼저 현재 변경사항을 확인하고 적용 가능 여부를 검사하세요.

```powershell
git status --short
git apply --check ../CareerLens-frontend/docs/api/member-shared-flow-backend.patch
git apply ../CareerLens-frontend/docs/api/member-shared-flow-backend.patch
python -m pip install -r requirements.lock.txt
```

다른 변경이 있거나 기준 버전이 다르면 패치를 강제로 적용하거나 코드를 초기화하지 말고
팀 변경과 함께 병합합니다. 과거 익명 대시보드 패치는 폐기된 접근 정책이므로 적용하지 않습니다.

적용 내용은 일반 회원 인증이 필요한 대시보드 요약·상세, 안전한 상세 계측,
공유 흐름 API/Redis 저장소, 워커 진행·종료 이벤트와 상태 확인, 재연결 및 경쟁 조건 수정,
관련 합성 테스트와 설정 문서입니다. 관리자 ID 설정은 필요하지 않습니다.
개인 이력서·보고서의 소유권 검사는 유지됩니다. 개인 `.env`, 키, DB, 로그와 보고서는 포함하지 않습니다.

운영에서는 **API·워커·프론트 비회원 엔진 모두 같은 `CAREERLENS_FLOW_REDIS_URL`**을
사용하고 `APP_ENV=production`으로 실행합니다. Redis 의존성이 잠금 파일에 포함되어 있습니다.
일반 로그인 계정으로 대시보드와 이용 흐름을 확인할 수 있으며, 비회원 조회는 401입니다.
개발 환경에서 Redis를 생략하면 `scope: process`이며 다른 워커 프로세스까지 통합되지 않습니다.

운영 DB의 기존 스키마/RPC/체크포인트와 공고 데이터는 이미 준비되어 있어야 합니다.
이번 패치에 새 DB 마이그레이션은 없습니다. 회원 분석을 새로 접수할 때 공유 워커 상태가
없거나 Redis 상태를 확인할 수 없으면 503으로 거절합니다. 이미 접수된 중복방지 요청의
복구는 기존 실행을 반환합니다. 진행 중인 분석은 관찰 이벤트 전송 실패로 실패 처리되지 않습니다.

서버 이벤트 전송은 최선 노력 방식입니다. Redis 장애 동안 일부 이벤트·완료 기록이
유실될 수 있고, 재연결만으로 해당 이벤트의 복원이 보장되지는 않습니다.
최근 보관 범위는 최대 24시간·전체 50,000개 이벤트·5,000개 소스이며 무제한 감사 기록이 아닙니다.
전체 배포 구성과 단일 프론트 인스턴스 제한은 `infra/deploy/production.md`를 참조하세요.

테스트 환경에서는 `python -m pip install -r requirements-dev.txt` 후
`python -m pytest -q`로 Redis Lua 합성 검증까지 실행합니다.
실제 Docker 배포, TLS, Supabase 설정 및 다수 사용자 처리 용량 검증을 대체하지 않습니다.
