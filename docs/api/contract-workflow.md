# API 명세 전달 절차

백엔드 API의 요청·응답 스키마를 원본으로 관리합니다.
HTTP 프레임워크를 선택하면 서버에서 OpenAPI JSON을 추출하는 명령을 구현하고, 아래 내보내기 절차에 그 파일을 입력합니다.
현재 서버·엔드포인트·API 명세는 아직 없습니다. 스키마를 수작업으로 중복 작성하지 않습니다.

## 백엔드에서 릴리스 산출물 만들기

백엔드 저장소에서 다음 명령을 실행합니다.

```powershell
pwsh -File scripts/export-api-contract.ps1 -Source <서버에서-생성한-openapi.json> -Version 1.0.0
```

도구는 OpenAPI 3.x 기본 구조와 `info.version`을 확인한 뒤 다음 파일을 생성합니다.

```text
contracts/openapi/v1.0.0/
├── openapi.json
└── manifest.json
```

manifest에는 계약 버전과 OpenAPI JSON의 SHA-256 해시가 들어갑니다.
같은 버전에 다른 내용이 들어오면 덮어쓰지 않습니다. 계약이 바뀌면 버전을 올려 새 산출물을 만듭니다.
이 검증은 기본 구조·버전·무결성 검사이며 전체 OpenAPI 의미 검증과 호환성 검사는 서버 구현 후 추가합니다.

## 두 저장소 사이 전달

1. 백엔드 테스트와 명세 내보내기를 통과한 산출물을 검토합니다.
2. 승인된 저장소 태그/릴리스 또는 CI artifact에 버전별 `openapi.json`과 `manifest.json`을 공개합니다.
3. 프론트엔드는 해당 릴리스의 `openapi.json` URL 또는 다운로드한 파일을 명시적으로 입력해 동기화합니다.
4. 프론트엔드 snapshot과 계약 lock 변경을 함께 검토·커밋하고 UI/API 연동 테스트를 수행합니다.

프론트엔드의 실행·빌드가 백엔드의 로컬 체크아웃 경로에 의존하지 않게 합니다.
원격 Git 주소가 아직 없으므로 실제 태그·릴리스·업로드는 수행하지 않았습니다.

## 프론트엔드에서 받기

프론트엔드 저장소에서 다음 명령을 실행합니다.

```text
node scripts/sync-api-contract.mjs --source <릴리스-URL-또는-다운로드한-JSON> --version 1.0.0
node scripts/sync-api-contract.mjs --check
```

프론트엔드는 `src/shared/api/openapi.json`과 `contract-lock.json`을 관리합니다.
타입/클라이언트 생성기는 프론트엔드 기술 선택 후 이 snapshot을 입력으로 연결합니다.
호환성이 깨지는 변경은 major, 기존 요청과 응답을 유지하는 기능 추가는 minor, 설명·오류 수정처럼 호환성을 유지하는 수정은 patch로 구분합니다.
계약 버전은 각 저장소의 애플리케이션 버전과 구분합니다.

`contracts/schemas`의 JSON Schema가 필요하면 동일 백엔드 모델에서 생성하고 별도 수작업 원본으로 관리하지 않습니다.
