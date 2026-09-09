# Local migration handoff preparation

검증: 2026-09-09 18:38 (KST).

## 구현

- EncryptedReplica.installSnapshot의 migrationJournal 옵션은 같은 encrypted store, ACTIVE 단계, vault/target epoch, 기존 readback manifest와 최소 snapshot seq를 검사한다.
- 기존 서명/복호화/snapshot manifest 검증 후 confirmed/visible/cursor와 로컬 READY 기록을 같은 트랜잭션으로 설치한다. 검증 도중 journal 변경도 거부한다.
- snapshot 설치 및 일반 draft 생성은 이관에서 예약한 device counter까지 이어받는다. 서명 전 예약만 하고 전송하지 못한 번호도 재사용하지 않는다.
- legacyPending.preserveLegacyPending은 v2 SQLite를 OPEN_READONLY로 열고 단일 읽기 트랜잭션으로 페이지 복사한다. 계정을 확인하고 confirmed base, applied가 아닌 outbox, 모든 recovery item을 암호화 저장소에 보존한다.
- accepted/응답 불확실 요청도 자동 재전송하지 않는다. 완료된 복사만 REVIEW_REQUIRED, 중단된 복사는 COPYING으로 남는다. 기존 SQLite와 v3 outbox는 변경하지 않는다.
- 128행 단위, 인코딩 페이지 4 MiB/총 128 MiB/100만행 초과는 실패한다. 원본을 자르거나 삭제하지 않으며, 실패한 복사는 별도 ID로 재시도 가능하다.

## 검증과 남은 경계

Desktop E2EE 회귀 75/75 통과. 신규 테스트는 counter 인계/재시작, ACTIVE 및 readback 없는 설치 거부, 손상 snapshot에서 READY 미기록, 기존 pending 보존, 원본 SQLite 바이트 보존, 잘못된 계정/누락 파일 거부, 복사 중 쓰기 실패, 저장 파일의 synthetic 평문 미포함을 확인했다.

이것은 전환 준비 모듈이다. 일반 앱에서 실제 주 DB를 선택하는 연결, quiesce 및 동시 편집 차단, pending 중복/충돌 판정·v3 변환·복구 UI는 아직 미구현이다. 사용자 데이터 이관·평문 삭제·배포·실기기 검증은 수행하지 않았다. #54는 WIP를 유지한다.
