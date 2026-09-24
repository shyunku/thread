# v3 이관 후 서버 평문 정리 계획

작성: 2026-09-23 16:22 (KST) · #57.2 · 설계 검토용

## 정확한 범위

정리 대상은 확인된 단일 계정의 v2 평문 사본이다.

| 묶음 | 테이블 |
| --- | --- |
| 할 일·관계 | `sync_occurrences`, `subtasks`, `task_categories`, `tasks`, `categories` |
| v2 동기화 | `sync_change_log`, `sync_receipts`, `sync_snapshot_pages`, `sync_snapshots` |
| v3 이관 중 생성된 평문 | 해당 계정의 `vault_migration_source_pages` |
| v1 이전 자료 | 해당 UID의 `blocks`, `transactions` |

`user_master`와 `sync_users`는 로그인과 v3 계정 라우팅에 필요하다. `sync_devices`·`sync_backfills` 등의 이전 프로토콜 메타데이터도 이 계획에서는 유지한다. `vaults`, 서명된 멤버십·이관 검증 기록, `encrypted_records`, 암호문 객체/변경/스냅샷, 관련 key envelope는 유지한다. 이 계획은 SQL 덤프, Docker volume snapshot, 로그, Redis, 클라이언트 저장소 및 외부 백업 보관 정책을 결정하지 않는다.

## 실행 전 조건

1. 사용자에게 v3에서 할 일·반복·카테고리·미전송 변경이 정상인지 묻고, 실제 확인한 계정과 이관 ID를 명시적으로 기록한다. UI/승인 증빙 방식은 운영 정책으로 확정해야 한다.
2. 해당 계정의 `sync_users.mode=e2ee`, `vaults.mode=active`, 동일 계정의 `vault_migrations.phase=ACTIVE`, 이관 attestation 및 공유 암호문 참조를 재확인한다. v2로 쓰는 모든 서버를 중지한다.
3. 새 DB 백업을 보존하고 별도 DB 복원을 검증한다. 백업 파일의 SHA-256과 보존 위치·기간을 운영자가 승인한다.
4. 읽기 전용 `v3-legacy-inventory` 출력과 백업/로그 목록을 함께 검토한다. 행 수 0만으로 백업·로그 부재를 판정하지 않는다.

## 제안한 원자적 동작

계정·vault·이관 상태를 잠그고 위 조건을 한 트랜잭션에서 다시 검사한다. 자식 테이블부터 정해진 순서로 해당 계정 행만 삭제하고 삭제 건수를 검증한 뒤 계정·이관 ID·백업 해시·시각만 purge ledger에 기록한다. 일부 삭제가 실패하거나 다른 계정의 참조가 발견되면 전체 트랜잭션을 롤백한다. 재실행은 ledger와 잔존 행을 확인하여 이미 정리한 계정을 다시 삭제하지 않는다. 커밋 후 되돌리기는 검증한 백업에서 복원하는 별도 작업이다.

MySQL 행 삭제만으로 과거 백업·복제본·디스크의 물리적 잔여 바이트가 즉시 제거된다고 보장하지 않는다. 서버는 이전 v2 데이터가 완전히 사라졌다는 배지를 자동으로 표시하면 안 된다.

## 현재 상태

읽기 전용 inventory와 합성 데이터 백업→별도 DB 복원·해시 비교까지 구현·검증했다. 운영 purge를 실행할 수 있는 코드는 추가되지 않았다. 자동 승인 검토가 실제 계정 평문 행을 삭제할 수 있는 코드 추가를 별도 명시 승인 필요로 거부했기 때문이다. 승인 전에는 이 문서가 실행 절차나 데이터 삭제 권한을 부여하지 않는다.
