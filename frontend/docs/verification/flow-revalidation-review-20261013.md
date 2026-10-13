# 이용 흐름 게시 전 독립 재검토

2026-10-13. 백엔드 소스·실제 계정·실제 워커·유료 분석에는 변경이나 요청을 보내지 않았다.

검토 범위: activity-flow/events.js, live-sources.js, viewer.js, auth/operations-access.js, shared/api/client.js, app/main.js, pages/my-page.js와 대응 테스트.

## 확정 문제와 수정

비활성 관찰 창에서 회원 확인이 일시적으로 실패하면 재시도 타이머가 `verify()`를 호출했지만, document.hidden 검사에서 즉시 반환했다. 이때 재시도 타이머를 이미 제거했고 포커스 감시도 중단된 상태라 자동 복구가 더 진행되지 않았다.

제한된 자동 재시도 3회는 최초 회원 확인과 동일하게 `verify(true)`를 호출하도록 수정했다. 일반 60초 주기 확인은 계속 비활성 창에서 중지된다. 회원 확인 성공 전에 데이터를 표시하지 않으며, 401/403 차단과 페이지 정리 시 타이머 취소를 유지한다.

회귀 테스트 `a background observer recovers from a temporary outage through its bounded retry`는 수정 전 회원 확인 호출 1회/기대 2회로 실패했고, 수정 후 통과했다.

## 검증

다음 8개 테스트 파일 총 127개 통과:

- operations-access.test.mjs
- activity-flow-events.test.mjs
- activity-flow-live-sources.test.mjs
- activity-flow-viewer.test.mjs
- api-flow-lifecycle.test.mjs
- api-session-observation.test.mjs
- auth-flow-live.test.mjs
- my-page.test.mjs

이 범위에서 추가 확정 결함은 발견하지 않았다. A/B/C 고정 추적, 복제된 sessionStorage 분리, 새로고침 재연결, 로그인·로그아웃 관측, 중복 이벤트 재생 억제, 완료 카드 중립화, 회원 전용 접근을 재검증했다. 직전 실제 Chromium 3쌍 통합 검증은 [브라우저 검증 기록](rollback-journey-browser-20261013.md)을 재사용했다. 이번 자동 복구 수정은 결정적인 수동 타이머 단위 검사로 검증했으며 브라우저 장애 주입 시험을 추가 실행한 것으로 주장하지 않는다.
