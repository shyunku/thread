# Schema migrations

작성: 2026-09-05 22:02 KST
브랜치: `refactor/canonical-sync-v2`
상태: 실행기 구현 및 SQLite 검증 완료, 실제 MySQL 검증 대기. 운영 적용 전 문서다.

## 세 가지 버전을 구분한다

| 값 | 의미 | 현재 구현 |
| --- | --- | --- |
| desktop package version | 설치 앱 릴리스 | 기존 값 유지 |
| legacy scheme_version / STATE_SCHEME_VERSION | v1 데이터 구조·transaction wire format | 변경하지 않음 |
| DB schema migration version | DB에 적용한 순서 있는 구조 변경 | 서버 2, local root 1, local user 2 |

Sync protocol v2의 account 전환과 schema version 2는 다르다.
서버 schema 2가 되었다고 legacy block 데이터를 지우거나 v2 동기화를 켜지 않는다.

## 서버 자동 실행

`services/api/service/database/migrations`의 immutable manifest를 API 시작 시 DB 연결 직후 실행한다.
migration 성공 전에는 Chain 로드나 HTTP/WebSocket 수신을 시작하지 않는다.

- 기존 Docker의 초기 thread.ddl은 새 volume을 위한 baseline 생성으로 유지한다.
- 기존 DB에는 thread_schema_migrations ledger를 만든다.
- schema 1은 user_master/transactions/blocks의 필요한 컬럼을 확인해 기존 구조를 채택한다.
- schema 2는 빈 sync_users 준비 테이블을 만든다. 모든 실제 사용자의 이관·mode 전환은 별도 구현/검증 단계다.
- 기존 tasks 데이터·blocks·transactions 내용은 수정하지 않는다.
- 향후 schema 3, 4 등을 manifest 끝에 추가하면 다음 API 기동 때 순서대로 적용된다.
- 이미 적용한 SQL/name/requiredTables를 바꾸면 checksum 불일치로 시작을 거절한다.
- 현재 코드보다 미래 schema 또는 중간 누락이 있으면 downgrade/잘못된 이력으로 시작을 거절한다.
- manifest 전체용 DB connection을 하나 확보하고 MySQL GET_LOCK을 사용해 여러 인스턴스를 직렬화한다. RELEASE_LOCK 실패 시 해당 connection을 pool로 반환하지 않는다.
- 기동 migration 제한은 2분, advisory lock 대기는 10초다. 큰 backfill에는 이 runner를 쓰지 않는다.

### MySQL DDL 실패

MySQL DDL batch는 애플리케이션 transaction으로 완전히 rollback할 수 없다.
버전 실행 전에 applying을 영속화하고 모두 성공했을 때만 applied로 기록한다.
중간 실패나 process 종료 뒤 applying이 남으면 다음 기동은 중단한다. 자동 재시도·자동 ledger 삭제·무조건 IF NOT EXISTS로 건너뛰지 않는다.

운영자는 먼저 backup과 실제 schema/실행된 statement를 확인한다.
빈 준비 table의 부분 생성인지 실제 데이터 변환이 있었는지 판단한 뒤 복구 절차를 결정한다.
ledger만 임의로 applied로 바꾸거나 지우지 않는다. 자동 destructive down migration은 제공하지 않는다.
운영 DB 자동 migration 전에 restore 가능한 backup을 준비해야 한다. 이번 runner는 production MySQL backup을 대신 만들지 않는다.

## Desktop 자동 실행

`public/electron/migrations/schema.js`는 root/user SQLite 연결 직후 실행된다.
DB service는 migration promise가 끝날 때까지 context를 다른 호출자에게 공개하지 않으며 동일 DB 동시 초기화를 공유한다.

- 기존 root-v1.sqlite3와 datafiles/v2/user-*.sqlite3 경로·템플릿은 유지한다.
- schema 1은 각 DB의 필요한 테이블/컬럼 baseline과 scope를 검증하고 ledger에 기록한다.
- user schema 2는 thread_sync_metadata를 추가하고 protocol=1로 둔다. 실제 outbox·canonical local view는 후속 migration에서 구현한다.
- 버전 업그레이드가 있을 때 SQLite VACUUM INTO로 같은 DB 폴더 아래 schema-backups/에 고유 이름의 일관된 snapshot을 만든다.
- 기존 backup은 덮어쓰거나 자동 삭제하지 않는다. root backup에는 인증 정보가 포함될 수 있으므로 외부 공유/커밋 금지.
- backup 실패 시 schema를 바꾸지 않는다.
- BEGIN IMMEDIATE 아래 적용 이력을 다시 검사하고, 필요한 모든 SQL과 버전 기록을 동일 transaction으로 커밋한다.
- SQL 실패 시 DDL과 버전이 함께 rollback된다. 백업은 복구를 위해 남긴다.
- checksum drift, 미래 버전, root/user scope 불일치는 실패한다.
- 새 연결은 foreign_keys=ON, busy_timeout=10000, synchronous=FULL로 준비한다. 기존 OFF 대비 쓰기 지연은 늘 수 있지만 crash durability를 우선한다.
- 이번 경로는 구 migrateLegacyDatabase의 UUID 재생성·서버 overwrite를 자동 호출하지 않는다.

SQLite schema-backups/는 사용자 데이터와 같은 로컬 보안 경계에 있다. 배포 파일이나 Git에 포함하지 않는다.
v2 account 데이터 이관용 새 DB와 구 outbox import는 [설계안](designs/canonical-sync-v2.md)에 따라 별도로 구현한다.

## 검증 명령과 범위

프로젝트 루트:

```powershell
node --test apps/desktop/tests/schemaMigration.test.cjs apps/desktop/tests/databaseReady.test.cjs
pnpm --dir apps/desktop run build
```

services/api 디렉터리:

```powershell
go test -vet=off ./...
go test -vet=off -v ./service/database/migrations
```

SQLite 테스트는 저장소의 빈 template를 테스트별 임시 폴더에 복사해서 수행한다. 사용자의 실제 SQLite/env/로그를 읽지 않는다.
검증 항목: 데이터 보존·백업 integrity/restoration, no-op 재기동, root/user 독립 버전, 실패 후 DDL/version rollback, checksum drift, 미래 버전, 동시 connection 및 DB ready 경합.

MySQL 통합 시험은 THREAD_MIGRATION_TEST_DSN을 명시적으로 제공해야 실행된다.
대상 DB명은 thread_migration_test_로 시작하고 table이 하나도 없어야 한다. 기본 DB/운영 env를 자동으로 읽지 않는다.
시험은 해당 빈 DB에 synthetic table/data를 만들며 결과와 applying marker를 남겨 검사할 수 있게 한다. DB를 자동 drop하지 않는다.
미지정 상태에서는 MySQL 통합 시험을 SKIP한다. 따라서 일반 Go 테스트 통과를 실제 MySQL 검증 완료로 보고하면 안 된다.

검증할 MySQL 시나리오: 반복 기동 no-op, legacy row 보존, 두 connection의 migration exactly-once, downgrade/checksum 차단, 부분 DDL 실패 후 dirty marker와 재기동 차단.
현재 Docker 미실행으로 실제 MySQL 시험은 대기 중이다.
