# Legacy sync preflight

작성: 2026-09-05 22:46 KST
브랜치: `refactor/canonical-sync-v2`
관련: [설계](designs/canonical-sync-v2.md), [schema migrations](schema-migrations.md), [tasks #23](tasks.md)

## 목적과 한계

`services/api/cmd/sync-preflight`는 **기존 MySQL을 읽기만** 해서 사용자별 canonical 이관 계획을 만든다.
schema runner·ChainCluster·legacy executor를 호출하지 않는다. 계정 mode/epoch 변경, INSERT/UPDATE/DELETE, 블록 replay, local DB 이관은 하지 않는다.
출력 파일은 이후 importer가 사용할 데이터 후보이며 실제 이관 완료 증거가 아니다.
사용자가 입력한 정확한 UID만 조회한다. 운영 DB에는 이 도구를 아직 실행하지 않았다.

## 사용

services/api에서 실행한다. 운영에서는 복구 가능한 backup/사본에 대한 검증을 먼저 수행하고 **SELECT 전용 계정**을 사용한다.

```powershell
go run ./cmd/sync-preflight -user ACCOUNT_UID -dsn-env THREAD_PREFLIGHT_DSN
```

THREAD_PREFLIGHT_DSN은 사용자가 별도로 제공한 MySQL DSN 환경 변수다. 도구는 .env 파일을 로드하지 않고 기본 앱 DB 설정도 사용하지 않는다.
예시 형식은 read-only-user:password@tcp(host:3306)/database 이다. 실제 값을 채팅·Git·공유 로그에 넣지 않는다.

기본 stdout에는 formatVersion, UID, snapshotNumber, sourceChecksum, rowsChecksum, counts, warnings만 출력한다.
제목·메모·하위 작업 내용·인증 값은 기본 출력에 포함하지 않는다.

내용이 포함된 이관 파일이 필요할 때만 새 경로를 명시한다:

```powershell
go run ./cmd/sync-preflight -user ACCOUNT_UID -plan-out NEW_PRIVATE_PATH.json
```

기존 파일/심볼릭 링크를 덮어쓰지 않는다. 생성 모드는 0600이며 Windows에서는 적절한 폴더 ACL도 운영자가 확보해야 한다.
내보내기 파일에는 개인 Task 내용이 들어 있으므로 Git에 추가하거나 공개 공유하지 않는다.
쓰기/디스크 동기화 실패 시 INCOMPLETE 오류로 종료한다. 남은 파일은 정상 plan으로 취급하지 말고 검사한다.
plan 파일은 사용자와 원본 checksum에 묶여 있다. 이후 importer는 현재 원본 fingerprint와 rowsChecksum을 다시 검증해야 한다.

## 읽기·검증 범위

- 한 사용자를 REPEATABLE READ + READ ONLY transaction으로 조회한다.
- 해당 사용자의 전체 block metadata와 **최신 persisted State 1개만** 읽는다.
- 최신 block에 LIMIT 1을 사용하지 않는다. 같은 번호의 row가 여러 개면 선택하지 않고 중단한다.
- user_master 존재, transaction 참조/소유자, version=2, 지원된 legacy type 19개를 확인한다.
- 전체 상태 replay 없이 이미 영속화된 최종 snapshot을 평탄화한다. type 시험은 header 호환성 시험이며 executor 의미 동등성 시험은 아니다.
- (user,block_number), block hash, transaction hash의 중복/모호성을 차단한다.
- ID를 새로 생성하거나 잘라내지 않는다. task/subtask/category의 map key와 내부 ID가 다르면 중단한다.
- task next 연결의 단일 head·참조 대상·복수 predecessor·cycle·전체 방문을 검사한다.
- category/subtask 참조와 지원 repeat_period를 검사한다.
- 잘못된 UTF-8, JSON 중복 키·null·알 수 없는 필드·누락 필드로 인해 기본값이 생기는 decode를 거절한다.
- 기존 DTO가 표현하는 scalar 값을 그대로 유지하며 임의 날짜/문자열 보정을 하지 않는다.

안전 예산: snapshot 128MiB, task 100,000개, block metadata 250,000개, 전체 DB 조회 2분.
초과는 오류로 중단하며 일부만 잘라 정상 plan으로 반환하지 않는다. 더 큰 계정은 별도 streaming 전략을 검토한다.
역사적 block 번호 gap은 LEGACY_HISTORY_GAP 경고로 기록한다. 최신 snapshot의 분석은 가능하지만 **누락된 과거 이력이나 offline pending이 복구됐다는 뜻이 아니다**.
경고가 있는 계정은 운영 cutover 전에 별도 조사가 필요하다.

## Plan 구조

- tasks: 원본 필드의 snake_case 컬럼, 원본 ID, 결정적인 sort_rank.
- subtasks: 원본 ID·필드와 부모 task_id.
- categories: secret/locked/color/created_at을 포함한 원본 필드.
- taskCategories: task_id/category_id/present 관계.
- legacyBlocks: 원본 block/transaction identity와 내용 digest.
- sourceChecksum: 사용자·경계·원본 State bytes checksum·정렬된 metadata의 fingerprint.
- rowsChecksum: 정규화된 row 집합의 checksum.

sort_rank는 기존 next 순서에서 2^32 간격으로 만들며 JSON string이다.
날짜·완료/반복 값은 새로 계산하지 않는다. 반복 완료를 재실행하거나 새 UUID를 만들지 않는다.
transaction digest는 원본 version/type/timestamp/content bytes 기준이다. 의미는 같지만 직렬화가 다른 local transaction을 자동으로 같다고 판단하는 도구는 아니다. local pending의 의미 비교·ID 대응은 #26에서 다룬다.
체크섬은 재실행/변조·원본 변경 검출을 위한 값이며 blockchain/hash chain을 새로 도입하는 것이 아니다.

## 검증

```powershell
go test -vet=off ./...
go build ./cmd/sync-preflight
```

실제 MySQL 테스트는 두 변수를 명시해야 실행된다:

- THREAD_PREFLIGHT_TEST_DSN: 비어 있는 thread_preflight_test_ 접두사 테스트 DB의 fixture 생성용 계정.
- THREAD_PREFLIGHT_TEST_READ_DSN: 같은 DB의 **다른 SELECT 전용 계정**.

미지정이면 MySQL 시험은 SKIP된다. 일반 Go 테스트 성공만으로 MySQL 검증 성공이라 하지 않는다.

2026-09-05 22:46 KST에 별도 mysql:8.0 tmpfs 환경에서 다음을 확인했다:

- 동일 block_number=1인 두 사용자 snapshot 격리.
- SELECT-only reader로 원본 state bytes 보존 및 재실행 checksum 일치.
- reader의 DELETE 권한 부재, 중복 최신 block·cross-user transaction·고아 block 차단.
- 실제 CLI로 빈 계정의 내용 없는 summary 출력.
- 단위 시험: 필드 보존, strict JSON, 19개 legacy type header, 중복 provenance, 파일 덮어쓰기 차단, 명시적 DSN 요구.
- 10,000 task snapshot 변환 및 분리된 cycle 탐지.
- API 전체 Go 회귀·CLI 빌드 통과.

테스트 컨테이너와 synthetic DB는 검증 후 제거한다. 운영 볼륨·사용자 SQLite·실제 env는 변경하지 않는다.
