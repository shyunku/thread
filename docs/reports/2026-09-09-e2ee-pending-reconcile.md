# Legacy pending reconciliation

검증: 2026-09-09 18:42 (KST).

- legacyReconcile은 완료된 동일 계정 intake의 모든 페이지 수량/바이트/SHA256을 먼저 검증한다. 원본 페이지나 v2 DB는 삭제하지 않는다.
- 기존 confirmed base, v2 요청, 복호화된 v3 confirmed를 canonical identity로 대조한다. base version이 정확하고 같은 필드의 원격 변경이 없는 pending 제목/메모 patch만 변환한다. 관련 없는 원격 필드는 유지한다.
- 이미 원하는 값이면 ALREADY_PRESENT로 기록한다. accepted/거절 요청, 삭제/누락, 반복·정렬·관계·기타 필드, 동일 항목의 연속 편집, 기존 로컬 pending 충돌은 REVIEW_REQUIRED로 보존한다.
- confirmed의 현재 object version을 base로 v3 draft를 만든다. 전송은 기존 동기화 엔진의 별도 단계이며 서버 version CAS가 이후 원격 경합을 처리한다.
- 변환 결정과 outbox/counter/visible 갱신은 암호화 DB의 같은 트랜잭션이다. 동일 intake/change ID 재시도는 중복 draft를 만들지 않는다.

검증: Desktop E2EE 78/78 통과. 신규 사례는 필드 충돌과 삭제 거부, 다른 원격 필드 보존, ACK 불확실성, 연속 편집 분리, 멱등성, 손상 intake 거부, 결정 저장 실패 시 outbox/counter 롤백이다.

남은 경계: 호출자는 기기 승인·키 확보·최신 snapshot 검증 후 사용해야 한다. 실제 앱 coordinator/주 DB 연결과 복구함 검토 UI는 아직 연결하지 않았다. 구조적 연산은 자동 변환하지 않는다. 데이터량에 따른 성능 검증도 남아 있으며 현재 intake 상한 128 MiB/미전송 1만건 내에서 base index를 메모리에 보유한다. 실제 사용자 데이터/운영 서버에는 실행하지 않았다. #54 WIP 유지.
