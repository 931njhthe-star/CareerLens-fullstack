# 공통 API 연동

여러 기능에서 사용하는 API 클라이언트, 요청·응답 타입, 프론트엔드가 채택한 OpenAPI snapshot을 관리합니다.
한 기능에서만 사용하는 API 호출과 변환 코드는 해당 `src/features/<기능>` 내부에 둡니다.

`scripts/sync-api-contract.mjs`로 백엔드의 버전별 명세를 받아 `openapi.json`과 `contract-lock.json`을 함께 갱신합니다.
`client.js`는 같은 출처 `/api/v1` 요청, 세션 CSRF 토큰과 오류 처리를 담당합니다. 브라우저 기본 JavaScript를 사용하며 타입 생성기는 사용하지 않습니다.
UI 전용 타입은 `src/shared/types` 또는 기능 내부에서 관리합니다.

전달·검증·릴리스 절차는 [API 명세 전달 문서](../../../docs/api/contract-workflow.md)를 따릅니다.
백엔드 저장소의 상대 경로를 런타임, 빌드, 타입 생성 입력에 고정하지 않습니다.
