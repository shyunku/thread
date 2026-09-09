# Recovery review view

검증: 2026-09-09 18:47 (KST).

- vaultController.legacyReviews는 session.use를 통해 잠금 해제된 저장소에서만 조회한다. 잠금/폐기 후 조회는 거부한다.
- intake manifest 검증을 재사용하고 검토 대상 결정만 페이지 단위로 반환한다. 페이지 최대 50개, 텍스트 필드별 4096자이며 원문 요청·DB 경로·키는 반환하지 않는다. 전체 원본은 암호화 저장소에 그대로 남는다.
- LegacyRecovery는 원래 내용/이전 기기 수정/현재 내용, 충돌 사유와 삭제 여부를 보여주는 읽기 전용 컴포넌트다. 전송/삭제/덮어쓰기는 수행하지 않는다.
- unlocked=false 또는 sessionKey/intakeId 변경 시 이전 내용을 렌더링하지 않는다. 이전 비동기 응답은 effect 정리 후 폐기한다. 상위 화면은 계정·잠금 세대별 sessionKey와 안정된 loadPage 콜백을 제공해야 한다.

검증: backend 회귀 9/9, React DOM 테스트 2/2 통과. 잠금 조회 거부·페이지 제한·원문 요청 제외, 잠금 시 화면 제거, 다른 계정으로 넘어온 늦은 응답 차단을 확인했다. 테스트 라이브러리의 React act deprecation 경고가 있으나 테스트는 통과했다. Electron 실제 화면/픽셀 검증은 수행하지 않았다.

아직 일반 앱에 vault 세션 bootstrap이 없으므로 기존 Sync v2 메뉴를 바꾸거나 새로운 IPC를 무조건 노출하지 않았다. 일반 앱 메뉴/IPC 연결, 실제 주 DB 전환, 충돌 해결 선택·확정 동작은 미완료다. 사용자가 지금 일반 앱에서 이 화면을 열 수 있다는 의미가 아니다. #54는 WIP다.
