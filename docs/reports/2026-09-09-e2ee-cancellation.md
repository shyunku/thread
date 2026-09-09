# E2EE migration cancellation

검증: 2026-09-09 16:27 (KST).

이전 [활성화 기록](2026-09-09-e2ee-activation.md)의 승인 대기는 사용자의 명시적 구현 승인으로 해소됐다. 운영 DB에서 삭제를 실행하거나 E2EE를 활성화한 것은 아니다.

## 구현 및 보호 범위

- FROZEN/UPLOADING/VERIFIED만 취소 가능. ACTIVE는 거부한다.
- 계정·이관 ID·coordinator·target epoch·활성 시도를 확인하고 서명된 mutation과 receipt/object/snapshot의 출처를 대조한다. 불일치 데이터는 삭제하지 않는다.
- 해당 시도의 임시 암호문·receipt·snapshot·sync cursor 정리와 v2/pending 복귀는 단일 트랜잭션이다. 업로드/commit과 같은 순서로 잠근다.
- 기존 v2 원본·원본 snapshot·이관 source 복구 사본·검증 서명 감사 기록·키·device counter·로컬 복구 자료를 보존한다.
- 취소 재시도는 멱등적이다. 이전 취소 요청은 새 시도를 건드리지 않고, 늦은 업로드는 취소 후 데이터를 다시 생성하지 못한다.
- 클라이언트는 commit 응답 유실 시 서버 상태를 먼저 조회한다. 서버 ACTIVE이면 취소하지 않는다.

## 검증

- API 전체 go test ./... 통과.
- Desktop E2EE 회귀 70/70 통과.
- 빈 합성 tmpfs MySQL의 TestMySQLSignedMembership 통과: 업로드 후 취소, 검증 후 감사 기록 보존, 서명/범위 오류 거부, 삭제 중 실패의 전체 롤백, 새 시도 격리, 업로드 경합, commit 경합 3회.
- 실제 사용자 DB·환경 변수·기기 설치는 변경하지 않았다. UI/local cutover·늦은 기기 pending 및 운영 승인은 별도이며 #54는 WIP다.
