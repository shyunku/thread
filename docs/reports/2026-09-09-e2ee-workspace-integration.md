# Desktop vault workspace integration

검증: 2026-09-09 18:59 (KST).

## 실제 연결

개발 실행의 설정 → 데이터 → 보관함 검증 열기에서 생성/비밀번호 및 OS 잠금 해제/수동 잠금/보존된 복구 자료 비교 화면을 연다. serviceGroup → VaultWorkspaceService → LocalVault/VaultController → 제한된 vault IPC → VaultWorkspace/LegacyRecovery 경로를 연결했다.

계정 ID는 renderer 인자가 아니라 UserService에서 결정한다. 개발 계정별 별도 해시 경로를 사용하고 기존 SQLite는 읽거나 수정하지 않는다. 생성은 명시적인 비밀번호 설정으로만 수행하며 기존/불완전 보관함을 초기화하지 않는다. 패키징된 앱은 backend에서 비활성화한다. 이 경로는 서버 vault/genesis/키 복구 등록이나 실제 데이터 이관을 수행하지 않는다.

계정 변경, 수동 잠금, 화면 잠금, suspend, 5분 idle, 렌더러 종료/창 파괴 시 잠금/폐기한다. 비동기 응답은 계정/세대에 맞는 경우만 반영한다. 팝업/updater/OAuth는 vault 요청 권한이 없고 키/DB handle/파일 경로는 renderer에 노출하지 않는다. 복구 목록은 잠금 해제된 세션에서만 읽는다.

## 검증

- Node 암호화·서비스·IPC 회귀 88/88 통과.
- 설정/보관함/잠금/복구 UI 테스트 12/12 통과.
- Electron 43.6.0 Windows x64 합성 프로필 smoke: 실제 OS 키 보호, 암호화 DB 생성/재열기, sqlite3 로딩 통과. OS 인증 자체는 smoke에서 mock이며 실사용자 인증 검증과 구분한다.
- 일반 React 빌드 성공. CI=true는 기존 프로젝트 lint 경고 때문에 실패했고 CI=false 일반 빌드는 경고와 함께 성공했다. 새 화면과 변경한 설정 화면의 eslint 검사는 통과했다.
- 사용자 프로필/실제 DB/서버/환경 변수 파일은 직접 열어보거나 수정하지 않았다. 운영 활성화·purge·설치/푸시는 수행하지 않았다.

## 사용자 확인

개발 앱을 다시 실행하고 일반 계정 로그인 후 설정 → 데이터 → 보관함 검증 열기를 선택한다.

1. 12자 이상 별도 비밀번호 생성. 다음에 잠금 해제 화면으로 바뀌어야 한다.
2. 비밀번호 잠금 해제와 보관함 잠그기를 확인한다. 잘못된 비밀번호는 거부되어야 한다.
3. Windows Hello가 가능하면 취소 시 잠김 유지, 승인 시 잠금 해제를 확인한다.
4. 앱 재실행 후 같은 비밀번호로 재진입. 기존 할 일은 그대로 남고 서버 E2EE 미전환 문구를 유지해야 한다.

## 남은 구현

서버 genesis 등록/기기 연결/키 복구의 앱 bootstrap, 이관 실행 coordinator·v2 편집 정지·주 DB 선택, 일반 todo E2EE adapter, 구조적 pending 변환과 충돌 해결 UI, 모바일 통합이 남아 있다. 이번 연결만으로 #48/#54 또는 전체 E2EE를 DONE으로 처리하지 않는다. #57 운영 전환은 별도 승인이다.
