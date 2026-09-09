# Owner identity and recovery preparation

검증: 2026-09-09 21:51 (KST).

설정 → 데이터 → 보관함 검증 열기 → 잠금 해제 뒤 기기 키와 복구 준비를 연결했다. 사용자가 기기 키 준비를 누르면 로컬에서 owner/device signing·encryption key, signed genesis, 데이터 키, recovery bundle을 생성하여 암호화 저장소에 보존한다. 재시도는 기존 identity를 반환하며 교체하지 않는다.

일반 응답은 fingerprint/deviceId/준비 상태만 반환한다. 복구 코드는 명시적 보기 요청으로만 renderer에 반환하며 30초 후 숨긴다. 잠금 시 상위 화면이 제거된다. raw device/data key는 renderer에 전달하지 않는다.

복구 파일은 native dialog에서 선택한 신규 파일에 exclusive 생성·fsync한다. 기존 파일을 덮어쓰지 않는다. 저장 성공만으로 확인 완료로 처리하지 않으며, 파일을 다시 선택하고 코드를 입력해 실제 복호화한 keyring과 복구 authority가 현재 identity와 일치해야 RECOVERY_CONFIRMED가 된다. 읽기 최대 1 MiB를 적용하고 취소·실패·계정/잠금 세대 변경은 확인 완료로 처리하지 않는다.

검증: owner/recovery/workspace/pairing/IPC 관련 Node 테스트 15개 통과. RecoverySetup 및 VaultWorkspace React 테스트 4개 통과. 새 화면 lint 통과, production renderer build 성공(기존 프로젝트 경고 유지). 잘못된 코드·변조 파일·재시작·잠금·저장 덮어쓰기 방지·파일 재열기·코드 숨김·dialog 취소를 포함한다. native dialog의 실제 사용자 조작은 자동 테스트와 구분한다.

서버 등록·기기 승인·키 전달·데이터 이관은 이 화면에서 실행하지 않는다. 기존 v2 데이터도 변경하지 않는다. 초기 로컬 keyring은 아직 서버 epoch에 연결하지 않았으며 서버 identity 조회/등록과 기기 연결은 다음 통합 단계다. 전체 분실 복구·회전 UI와 실기기 전달 검증도 남아 #50/#55 WIP 유지. 실제 운영 이관은 #57에서 별도 승인 후 수행한다.
