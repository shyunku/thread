# v3 record 저장량 검증

기록: 2026-09-22 20:56 (KST) · #61 · 개인정보 없는 격리 MySQL 8 fixture

## 원인과 변경

100개 operation의 signed batch가 object마다 통째로 복제되고 snapshot에도 복제됐다. HEX 출력은 추가로 실제 바이트의 2배 길이다.

schema11은 `encrypted_records(vault_id, record_digest, signed_record)`를 추가한다. 각 object/change/snapshot은 vault+SHA-256 digest로 원문을 참조한다. 서명 bytes·operation index·프로토콜 응답은 변경하지 않는다. 기존 BLOB는 그대로 보관하고 조회는 공유 원문 우선/기존 원문 fallback이다. 신규 저장과 snapshot은 BLOB를 다시 복제하지 않는다.

## 측정

| 객체 | 공유 record | 공유 payload (B) | 이전 object 복제 방식 환산 (B) | 해당 구간 추가 생성 시간 |
| --- | --- | --- | --- | --- |
| 1,000 | 10 | 237,126 | 23,712,600 | 0.109초 |
| 10,000 | 100 | 2,371,476 | 237,147,600 | 1.125초 |
| 100,000 | 1,000 | 23,716,776 | 2,371,677,600 | 37.236초 |

100 operation/batch, operation당 합성 ciphertext 128B. 시간은 직전 단계부터 해당 개수까지 실제 SQL fixture 생성 시간이며 API 처리량 측정이 아니다. 수치는 OCTET_LENGTH 합계로 인덱스·행 메타데이터·과거 보존 BLOB·백업·네트워크를 제외한다. 실제 업무 데이터의 batch 크기에 따라 절감률은 달라진다.

| 검증 | 결과 |
| --- | --- |
| TestMySQLRecordStorageMigration | schema10 원문→11 backfill·재실행·원본 보존·원문 서명 및 1천/1만/10만 선형 증가 통과 |
| TestMySQLSignedMembership | 실제 서버 push/pull/snapshot·migration 취소·분실 coordinator 복구 포함 통과 |
| TestMySQLMigrationLifecycle | 신규/기존 이관·재실행·동시 실행·구버전 차단·checksum drift·부분 실패 dirty 차단 통과 |
| go test ./... | 전체 API 통과. 위 명시한 DB 테스트는 별도로 실제 MySQL에서 실행 |

## 배포 및 남은 승인

- 운영에는 적용하지 않았다. 새 API를 기동하면 schema11이 적용되므로 먼저 DB 백업·구 API 중지가 필요하다. 구/신 API 동시 쓰기와 자동 downgrade는 지원하지 않는다.
- DDL은 MySQL 특성상 전체 트랜잭션 rollback이 되지 않는다. 중간 실패는 기존 runner가 dirty로 막으며, 백업과 migration 상태를 확인한 뒤 복구해야 한다.
- 기존 signed_record 컬럼 삭제 코드 작성은 자동 승인 검토에서 거부됐다. 현재 변경은 기존 bytes를 지우지 않는 추가형 방식이다. 과거 BLOB 삭제는 대상 3개 테이블·공유 원문 일치 확인·백업/복원 조건을 정해 별도로 승인받아야 한다.
- 취소된 이관의 참조 없는 공유 record도 보존한다. GC 정책은 아직 적용하지 않았다.
- v2의 tasks/categories/subtasks 및 과거 평문 백업 삭제와는 별개다. 그 삭제는 #57 승인 범위다.
- snapshot 응답의 원문 반복은 유지한다. 이번 변경을 네트워크 절감 또는 과거 데이터 디스크 회수 완료로 간주하지 않는다.
