# Canonical Sync v2 설계안

작성: 2026-09-05 20:52 KST
상태: 구버전 정책 승인 완료 — schema migration 기반 구현 중, 운영 데이터 전환은 별도 검증·승인
브랜치: `refactor/canonical-sync-v2`
요구사항 원문: [patch260830.md](../patch260830.md)
작업 관리: [tasks.md](../tasks.md)

## 1. 범위와 현재 확인 수준

Electron은 유지한다. 이번 변경은 저장·동기화 설계이며 Tauri 전환, 인증 방식 변경, 협업 편집, alert 전달 기능은 범위 밖이다.
기존 사용자 ID, Task/Subtask/Category ID, 내용, 완료·반복 정보, 순서, 카테고리 관계와 미전송 오프라인 변경을 보존한다.
서버 데이터 초기화나 기존 DB/table 삭제를 전제로 하지 않는다.

현재 API 진입점, DDL, state 엔진과 WebSocket 경로, desktop DB/executor/syncer, mobile hook/Home/persist 경로를 정적으로 확인했다.
사용자 범위 확정: 모바일은 조회 전용이다. v2 snapshot·증분 조회·재접속 프로토콜은 맞추되 모바일 편집·쓰기 outbox·충돌 처리 구현은 이후 작업으로 분리한다.
실제 운영 DB, 사용자의 로컬 SQLite, env, 로그는 읽지 않았다. 실데이터 크기·무결성·모바일 배포 현황은 아직 미확인이다.
자동 schema migration 실행기와 sync_users 준비 테이블은 구현 중이다. 나머지 canonical entity·endpoint·flag는 아직 제안이다. 아래 성능 수치는 실측 결과가 아니라 검증 목표다.

## 2. 현재 구조와 문제

| 영역 | 현재 코드에서 확인한 동작 | 영향 |
| --- | --- | --- |
| API `service/state/chain.go: ApplyTransaction` | 상태 복사 → PreExecute → transitions 적용 → 전체 State 직렬화 → transactions/blocks 저장 | 작은 필드 변경도 전체 상태 크기에 비례한 CPU·저장 비용 |
| `transition.go: ApplyTransitions`, `state.go: Copy` | 전체 task/category 및 종속 map 복사 | 기존 비용은 수정한 entity 수만으로 제한되지 않음 |
| `block.go`, `controllers/v1/socket.go` | Block에 State 포함, broadcast_transaction으로 Block 전송 | 디스크 외에도 네트워크·클라이언트 파싱 비용 증가 |
| `chain.go` | DB commit 이전 캐시 InsertBlock, 내부 함수에서 DB 오류를 로그 후 반환, 외부는 newBlock,nil 반환 가능 | DB 저장 실패에도 성공 ACK/브로드캐스트 가능; 이관은 캐시가 아닌 영속 DB 기준 |
| `chain_cluster.go: LoadFromDatabase` | 전체 transactions와 blocks 로드; blockEntities의 key가 block_number뿐 | 서로 다른 사용자의 동일 번호가 충돌할 수 있음; 이관에서 이 로더 재사용 금지 |
| `thread.ddl` | blocks에 (uid,block_number) unique/PK 없음 | 중복·모호한 최신 스냅샷은 preflight에서 차단해야 함 |
| `socket.go` | blockNumber 일치 요구, hash 검증 일부 주석 처리, deleteMismatchBlocks·clearStatePermanently 노출 | v2의 단순 delta 동기화와 구버전 복구 의미론이 다름 |
| desktop `contexts/syncer.context.js` | local transactions를 재전송하고, 충돌 시 원격 삭제 후 로컬 transaction 재커밋 경로 존재 | v2 전환 뒤 구버전 쓰기 허용은 안전한 단순 호환이 아님 |
| desktop `database.context.js` | 기존 SQLite를 schema 버전별 디렉터리에 보관; synchronous=OFF 설정 | 새 DB를 별도로 만들고 crash-safe 커밋·백업 검증 필요 |
| mobile `Home.tsx` | 접속 시 state 초기화 후 stateByBlockNumber 조회, broadcast_transaction은 로그만 기록 | 현재 구현을 완성된 incremental/offline sync로 간주하지 않음 |
| mobile `rootReducer.tsx` | Redux/AsyncStorage persistence 사용 | 조회 캐시로 취급. v2 조회 프로토콜은 연결하되 쓰기 outbox는 이번 범위 밖 |

저장량 모델: 기존은 대략 O(변경 횟수 × 당시 전체 상태 크기). 목표는 O(현재 entity 수 + 보존 기간 내 변경 payload + 최소 중복 방지 기록).
영구적인 모든 변경 이력을 UI에서 재생하는 기능은 이번 목표가 아니다. 구 이력은 전환 중 보관하고 자동 폐기하지 않는다.

## 3. 제안 아키텍처

```text
UI
 └─ local DB transaction: materialized view 갱신 + outbox 삽입
      └─ Sync Engine
           ├─ HTTP push: 재시도 가능한 mutation
           ├─ HTTP pull: 확정 cursor 이후 delta
           └─ authenticated WebSocket: 변경 알림 + pull 유도
                    │
              MySQL transaction
               ├─ 사용자 sync row 잠금
               ├─ canonical entity 갱신
               ├─ change_log 기록
               └─ receipt + sequence 갱신
                    └─ COMMIT 후 ACK / WebSocket 알림
```

- 단일 사용자 쓰기를 DB row lock으로 직렬화한다. 프로세스 mutex만 신뢰하지 않는다.
- 사용자 간 데이터는 별도 lock으로 독립 처리한다. 한 사용자의 다중 기기에 적합하며 대규모 공동 문서 편집용 설계는 아니다.
- WS는 신속한 전달 수단이고 신뢰 원장은 DB change_log다. 연결·재연결·앱 foreground·주기적 reconciliation에서 pull한다.
- Redis pub/sub를 쓰더라도 단순 알림 수단이다. publish 실패 시에도 이미 커밋한 mutation을 실패로 되돌리지 않는다.
- v2 계정은 legacy Chain 전체 로드·캐시에 포함하지 않는다. API와 인증/관리자 경로는 유지한다.

## 4. Canonical schema 제안

아래는 논리 schema다. 실제 DDL은 기존 컬럼 길이·collation·engine을 preflight로 확인한 뒤 별도 버전 migration으로 작성한다.
Docker init DDL만 수정해서 기존 MySQL volume이 자동 변경된다고 가정하지 않는다.
모든 관련 테이블은 InnoDB, FK 삭제는 원칙적으로 RESTRICT이며 hard cascade를 기본값으로 두지 않는다.

### 4.1 공통 규칙

- auth UID는 기존 값을 보존한다. `sync_users.id BIGINT` 내부 키를 만들어 복합 인덱스 크기를 줄이고 `uid`는 기존 user_master와 길이·collation을 맞춘 UNIQUE/FK로 유지한다.
- task/category/subtask ID는 기존 문자열을 보존한다. UUID 형식 강제나 자르기를 하지 않는다. 예상 최대 255자를 넘는 실제 값은 차단·보고 후 별도 결정한다.
- 모든 entity PK/FK에 내부 user_id를 포함해 타 사용자 entity 참조를 차단한다.
- 서버 시간은 epoch milliseconds. 기존 created_at/due_date/done_at/repeat_start_at도 epoch milliseconds로 보존한다.
- legacy의 0/빈 문자열/null 차이는 필드별 변환표로 명시하며, 되돌릴 수 없는 임의 날짜 보정은 하지 않는다.
- seq·version 및 rank는 JSON에서 문자열로 전달한다. JavaScript Number의 정밀도에 의존하지 않는다.
- entity version은 마지막으로 그 entity를 변경한 사용자 seq다. 연속 정수일 필요는 없다.

### 4.2 테이블

| 테이블 | 주요 컬럼·키 | 역할 |
| --- | --- | --- |
| sync_users | id PK, uid UNIQUE/FK, mode, epoch, last_seq, min_available_seq, migration_run_id | 사용자별 권위 있는 sequence와 전환 fence |
| tasks | (user_id,id) PK; title TEXT, memo LONGTEXT, done, done_at, due_date, repeat_period, repeat_start_at, recurrence_generation, sort_rank, created_at, updated_at, deleted_at, version, field_versions JSON | 현재 task 상태. 기존 doneAt/repeatStartAt 누락 금지 |
| subtasks | (user_id,task_id,id) PK; title, done, done_at, due_date, created_at, updated_at, deleted_at, version, field_versions | 부모 task FK. 기존 nested ID 충돌 가능성을 보존 |
| categories | (user_id,id) PK; title, secret, locked, color, created_at, updated_at, deleted_at, version, field_versions | secret/locked/color 모두 보존 |
| task_categories | (user_id,task_id,category_id) PK; present, updated_at, version | 집합 전체 교체 대신 개별 관계 add/remove, false 행도 tombstone |
| sync_devices | (user_id,device_id) PK; protocol, device_generation, acknowledged_seq, last_seen_at, revoked_at | 기기 등록·진단·retention 참고값. device ID는 인증 수단 아님 |
| sync_change_log | (user_id,seq) PK; epoch, device_id, client_change_id, payload JSON, created_at | 하나의 논리 mutation당 한 행. payload.changes[]에 entity별 delta |
| sync_receipts | (user_id,device_id,client_change_id) PK; request_hash, status, seq, result_code, result_summary, created_at | 재시도 시 중복 실행 방지. 데이터 로그와 독립 보존 |
| sync_occurrences | (user_id,task_id,generation) PK; mutation identity, resulting_task_id, seq | 서로 다른 기기가 같은 반복 회차를 완료해도 회차 생성 1회 |
| sync_import_runs | run_id PK; user_id, source manifest/checksum, legacy cutover boundary, stage, counts, verification report | 재개 가능한 이관·비교 증거 |
| sync_import_items | source identity UNIQUE per user; source checksum, mapped change ID, import status | 여러 번 이관 시 구 transaction/로컬 변경 중복 방지 |

인덱스: tasks(user_id,deleted_at,sort_rank,id), tasks(user_id,deleted_at,done,due_date), subtasks(user_id,task_id,deleted_at), task_categories(user_id,category_id,present), change_log(user_id,created_at,seq).
field_versions는 제한된 허용 필드의 마지막 seq만 기록한다. entity 전체를 JSON으로 감싸는 저장 방식으로 대체하지 않는다.
유저 전체 삭제·관리자 초기화는 별도 승인된 정책과 epoch 변경이 필요한 동작이며 v2 일반 mutation에서 제공하지 않는다.

## 5. Mutation·충돌·순서

### 5.1 계약

```json
{
  "protocolVersion": 2,
  "epoch": "account-sync-generation",
  "deviceId": "registered-device",
  "mutations": [{
    "clientChangeId": "stable-uuid",
    "entityType": "task",
    "entityId": "existing-task-id",
    "operation": "patch",
    "baseVersion": "17",
    "changes": {"title": "새 제목"}
  }]
}
```

- operation은 create/patch/delete/move/completeRecurringTask 및 관계 add/remove처럼 검증된 allowlist만 지원한다.
- 클라이언트 user_id는 신뢰하지 않고 기존 JWT의 UID로 범위를 결정한다. 다른 기기의 ID 사칭은 device 등록 소유권으로 차단한다.
- field 미포함은 유지, null은 nullable 필드의 명시적 지우기다. unknown field/type/크기 초과는 거절한다.
- done/done_at은 하나의 논리 필드 그룹으로 처리해 done=false인데 과거 완료 시간이 남는 식의 모순을 막는다.
- create의 UUID, payload와 재시도 clientChangeId는 로컬 커밋 때 확정하며 재시도 때 새로 생성하지 않는다.
- baseVersion이 과거여도 mutation 전체를 거절하지 않는다. 미래 version은 INVALID_BASE_VERSION.
- 같은 entity를 같은 device가 순차 수정할 때 outbox local_order대로 하나씩 ACK 후 진행한다. ACK 전 요청 본문/ID 변경 금지.

### 5.2 원자적 쓰기와 중복

```text
BEGIN
SELECT sync_users ... FOR UPDATE
검증: 사용자 mode/epoch/device, 기존 receipt
동일 키 + 동일 request_hash -> 기존 결과 반환, 재실행 없음
동일 키 + 다른 payload -> IDEMPOTENCY_KEY_REUSED, 쓰기 없음
canonical row 읽기, 필드 검증/충돌 판정
seq = last_seq + 1
canonical rows + field_versions 갱신
change_log(seq, changes[]) 기록
receipt 기록 + sync_users.last_seq 갱신
COMMIT
ACK, 그다음 WS sync.available 전송
```

DB 오류/프로세스 종료 시 rollback하고 ACK하지 않는다. ACK 유실 시 같은 mutation key로 receipt를 조회한다.
로그만 저장되거나 canonical만 저장되는 경로는 허용하지 않는다.
사용자 lock을 COMMIT까지 유지하므로 seq 할당 순서와 해당 사용자 커밋 순서가 일치한다. 단순 전역 AUTO_INCREMENT를 commit 순서로 오인하지 않는다.
확정적인 domain reject도 작은 receipt로 기록해 동일 요청 재시도 결과를 고정한다. 인증 오류·일시적인 DB 실패는 영구 reject로 저장하지 않는다.
batch는 각 논리 mutation이 개별 atomic이다. 앞 mutation 실패 시 나머지는 not_attempted로 반환하고 순서를 건너뛰지 않는다.
payload hash는 idempotency 검사 목적일 뿐 block/prevHash chain은 없다.

### 5.3 Conflict policy

| 상황 | 제안 처리 |
| --- | --- |
| A.title 변경, B.done 변경 | 각 요청에 포함된 필드만 적용하므로 둘 다 유지 |
| A.title 변경, B.title 변경 | 사용자 DB lock 아래 나중에 적용된 요청이 승리. client wall-clock 사용 안 함 |
| 오래된 baseVersion | field_versions로 충돌 필드를 보고하면서 해당 필드의 server-ordered patch 적용 |
| 삭제 후 오래된 patch/create 재전송 | tombstone 우선, ENTITY_DELETED/ID_REUSED. 자동 부활 금지 |
| 부모 task 삭제 | task·subtasks·관계 tombstone을 같은 DB transaction 및 change envelope로 기록 |
| category 삭제 | 현재 API와 같이 사용 중이면 CATEGORY_IN_USE. 관계 해제 후 삭제하며 task 자체는 유지 |
| 서로 다른 카테고리 연결 변경 | 관계별 병합. 동일 관계 충돌만 서버 순서 적용 |
| remote 변경 위에 로컬 pending 있음 | remote base 갱신 뒤 로컬 pending을 다시 적용, 사용자 편집을 먼저 덮어쓰지 않음 |
| 유효하지 않은 부모·move anchor | 명시적 실패. 로컬 outbox를 지우지 않고 복구 UI에 보존 |

같은 필드의 오래된 offline 값이 나중에 도착해 최신 서버 값을 덮을 수 있다는 것이 server-order LWW의 의도된 tradeoff다.
전체 mutation ACK 결과에 conflictFields를 포함한다. 이를 조용한 데이터 소실로 숨기지 않고 필요 시 복구 가능한 로컬 기록을 유지한다.

### 5.4 반복 작업

현재 완료 동작은 단순 done=true가 아니다. 서버 `UpdateTaskDone`은 완료 기록 Task 복제, 다음 회차 due date 계산, subtasks 초기화, 순서 조정을 수행한다.
이 동작을 generic patch로 바꾸면 기능이 달라지므로 별도 completeRecurringTask 도메인 명령을 둔다.

- generation 및 예상 회차를 요청에 포함한다. 동일 회차의 다른 device 요청도 sync_occurrences로 중복 방지한다.
- 생성되는 task/subtask ID는 mutation identity에서 결정하거나 최초 receipt에 영구 기록해 재시도마다 바뀌지 않게 한다.
- completed instance 생성·원본 회차 전진·관계/순서·subtask 변화는 한 DB transaction이다.
- 기존 Go time 계산과 desktop moment 계산의 월말/윤년/시간대 차이를 fixture로 먼저 기록한다.
- due_date와 repeat_start_at 원본은 보존하며 이관 시 미래 날짜를 다시 계산하지 않는다.
- 시간대 정책이 확인되지 않은 계정에 일괄 Asia/Seoul 재해석을 하지 않는다. 반복 규칙 변경은 별도 승인 후 수행한다.

### 5.5 Task ordering

기존 DB에 prev_task_id를 새로 영속화하지 않는다. 서버 State는 next 링크, 요청은 prevTaskId 또는 targetTaskId/afterTarget이며 desktop은 prev/next를 계산한다.
목표는 단일 user task 목록에 sortable rank를 부여하고 화면 filter는 이 순서를 그대로 투영하는 것이다.

초기 제안은 bounded integer fractional rank: DECIMAL(65,0) 범위의 정수 rank를 문자열로 전달하고 서버는 arbitrary-precision 정수로 계산한다.
초기 간격은 2^32, 중간 삽입은 두 이웃의 정수 중간값이다. 앞/뒤 끝은 간격만큼 확장하며 범위·간격 소진 시 해당 user 목록만 재간격화한다.
같은 rank tie는 entity ID로 결정해 항상 total order를 제공한다. move 요청은 rank 자체가 아니라 anchor ID + before/after를 전송한다.
서버가 현재 이웃을 다시 읽고 rank를 할당하므로 offline의 stale rank가 새 순서를 깨지 않는다.
anchor가 삭제되면 ANCHOR_DELETED로 보존·재선택 안내한다. 자기 자신 anchor는 no-op.
재간격화는 실제 변경 rank만 하나의 원자적 change envelope에 기록한다. 요청 크기 제한은 사용자 입력에 적용하고 서버 재간격화 payload는 별도 streaming/page 설계로 처리한다.
수만 개 재간격화의 lock 시간·payload 예산이 검증 기준을 넘으면 bounded maintenance + snapshot reset으로 전환하며, 검증 전 이 경로를 활성화하지 않는다.
CRDT ordering/LexoRank 전체 구현은 초기 범위에서 제외한다. rank 정책은 성능 실험 후 확정한다.

## 6. Sync protocol

기존 인증 경로 /v1은 유지하고 데이터 동기화는 별도 /v2/sync namespace로 분리한다.

| Endpoint / topic | 계약 |
| --- | --- |
| GET /v2/sync/capabilities | protocol, account mode, epoch, supported operations. 클라이언트가 구 엔진에 진입하기 전 확인 |
| POST /v2/sync/devices | 인증된 UID 아래 device 등록. ID 충돌·복제 DB는 새 device generation |
| POST /v2/sync/push | mutations 배열, 각 accepted/duplicate/rejected/not_attempted 및 seq·결과 |
| GET /v2/sync/changes?after=...&until=... | 사용자/epoch에 묶인 cursor, 페이지 delta, nextCursor, hasMore, highWatermark |
| POST /v2/sync/snapshots | 일관된 전체 동기화 자료 생성, snapshotId·cursor S·만료 시각 |
| GET /v2/sync/snapshots/{id}/pages/{page} | 고정된 snapshot의 페이지와 checksum |
| WS /v2/sync/connect → sync.available | 커밋 후 epoch·highWatermark + 작은 경우 delta. 클라이언트는 cursor 기준 보완 pull |

push 예산 초안: 100개 mutation 또는 1MiB 중 먼저 도달한 한도. change pull 기본 500개 논리 mutation, 최대 바이트 제한도 둔다.
논리 mutation의 change envelope는 중간에서 적용/ACK하지 않는다. 큰 cascade는 분할 전송하더라도 로컬 staging 후 하나의 transaction으로 적용한다.
after cursor를 받은 사용자만 읽는다. 다른 UID의 cursor/snapshot token은 403, 알 수 없는 epoch는 RESET_REQUIRED.
첫 pull에서 high watermark H를 고정하고 후속 페이지는 seq <= H만 읽는다. 이후 새 cycle로 H 이후를 읽는다.
클라이언트 nextCursor는 실제 로컬 DB에 적용한 마지막 seq만 저장한다. push 응답의 가장 큰 seq로 cursor를 바로 점프하지 않는다.
중복 seq는 무시하며 gap 발견 시 pull한다. cursor 갱신·base 갱신·자기 outbox ACK 처리는 동일 로컬 transaction이다.
연결 중 WS 알림을 놓쳐도 주기적 pull과 foreground/reconnect pull로 최종 수렴한다. 알림만 기다리면 commit 직후 broadcast 실패를 영구 누락할 수 있다.

## 7. Offline-first local store

Desktop의 새 파일은 기존 v2 schema 디렉터리를 덮어쓰지 않는 별도 `datafiles/sync-v2/user-{uid}.sqlite3`로 만든다.
sync protocol v2와 기존 schema_version=2는 다른 개념이다. 기존 package config 숫자만 바꿔서 구 migration을 실행하지 않는다.
Mobile은 이번 단계에서 조회 캐시만 사용하며 새 SQLite outbox를 도입하지 않는다.

- confirmed_tasks/subtasks/categories/task_categories: 마지막 cursor까지의 서버 확정 상태
- tasks/subtasks/categories/task_categories: pending 변경을 포함한 UI materialized view
- pending_changes: stable client_change_id, device_id, local_order, operation, payload, base_version, status, error, original payload
- sync_state: epoch, cursor, device generation, local migration marker
- migration_legacy_receipts / recovery_items: 원본 이관 provenance와 자동 처리 불가능한 변경

로컬 편집은 UI table 변경과 pending insert를 한 transaction에서 커밋한다. UI 성공은 durable commit 뒤 표시한다.
remote delta를 confirmed table에 적용한 뒤 영향 entity의 pending을 local_order대로 재적용한다. ACK 수신 전에 optimistic row를 서버 row로 무조건 교체하지 않는다.
반복 완료·삭제 같은 다중 entity 명령은 해당 영향 집합 전체를 재적용한다. 실패한 pending은 recovery_items로 옮기되 원문을 보존하고 안내한다.
네트워크 timeout은 pending 유지, 동일 ID로 재시도한다. 영구 실패한 요청 내용을 수정할 때는 새 ID로 재제출하고 원래 실패 기록을 남긴다.
WAL/foreign_keys 및 안전한 synchronous 정책을 검증한다. 현재 synchronous=OFF를 새 DB에 복사하지 않는다.
WebSocket/메모리 eventQueue를 durable pending queue로 착각하지 않는다.

## 8. Retention과 full sync

초기 운영값은 자동 prune 비활성. 90일 retention은 관측 후 적용할 제안값이며 초기 배포부터 삭제하지 않는다.
활성 기기 ACK는 보존 최적화에 참고하되 오프라인 기기가 영원히 log 삭제를 막지는 않는다.

- 사용자 lock 아래 안전한 seq 경계 P까지 log를 정리하고 min_available_seq=P+1을 같은 transaction으로 갱신한다.
- after < P이면 410 RESET_REQUIRED + snapshot 절차를 반환한다. 빈 delta로 성공 처리하지 않는다.
- snapshots 생성 시 하나의 REPEATABLE READ consistent snapshot에서 sync_users.last_seq=S와 모든 canonical table을 읽는다.
- 이를 서버의 만료되는 고정 snapshot artifact로 완성한 뒤 공개한다. 페이지마다 live table을 다시 읽지 않는다.
- 생성 중 실패한 artifact는 공개하지 않는다. user/epoch/TTL에 바인딩하고 인증된 사용자에게만 제공한다.
- snapshot 다운로드 기간에는 S 이후 change log를 pin한다. pin TTL 만료 시 새 snapshot을 요청한다.
- 클라이언트는 outbox를 보존한 채 새 confirmed 상태를 staging DB/table에 적재하고 checksum 검증 후 원자적으로 교체한다.
- cursor=S와 교체를 함께 커밋하고, 불명확한 ACK는 receipt 조회 후 정리한다. 남은 pending을 새 base 위에 재적용한다.
- snapshot 만료/중단/디스크 부족은 현재 DB·outbox를 지우지 않는다.

중복 방지 보존은 log retention과 별개다. 초기 버전에서는 receipt key/request_hash/최소 결과, tombstone ID, recurrence receipt를 보존한다.
따라서 모든 저장량이 완전히 상수라는 주장은 하지 않는다. 큰 payload history는 잘라내고 작은 중복 방지 기록은 계속 증가하는 단순한 안전 우선 정책이다.
장기적으로 device generation 폐기와 영구 high-watermark 기반 compact를 설계할 수 있으나, receipt를 무작정 TTL 삭제하면 옛 retry가 다시 실행될 수 있으므로 이번 초기 prune 대상이 아니다.
삭제 ID를 재사용하지 않는다. tombstone payload는 축약할 수 있지만 ID fence는 남겨 오래된 offline edit의 부활을 막는다.

## 9. Migration 전략 — 기존 데이터와 offline 변경 보존

### 9.1 운영 호환 정책: 사용자 승인 완료

확정: account 단위 opt-in cutover. 미전환 계정은 v1을 그대로 사용하고, 전환한 계정만 v2가 유일한 writer가 된다.
전환 계정의 구 클라이언트 v1 sync 요청은 UPDATE_REQUIRED로 거절한다. 인증까지 차단하거나 로컬 DB를 지우지 않는다.
업데이트 뒤 legacy outbox/import 도구로 미전송 변경을 v2에 가져온다. 구 클라이언트 자체에 새 경고 UI가 없으면 일반 sync 오류로 보일 수 있다.
사전 bridge release에서 capabilities 확인·업데이트 안내·안전 export를 먼저 제공해 이 문제를 완화한다.

대안: 수정하지 않은 v1 클라이언트와 v2를 같은 계정에서 동시에 계속 동기화.
이는 legacy block/hash 생성, 서버 history 삭제/재생 의미론, full snapshot 제공까지 유지하는 양방향 compatibility engine이 필요하다.
단순 dual-write/임시 adapter가 아니며 복잡도·검증 비용이 크게 증가하고 제거하려는 snapshot 구조도 더 오래 남는다.
사용자가 첫 번째 정책을 승인했다. 구버전과 v2의 양방향 동시 쓰기 호환 engine은 이번 범위에서 제외한다.

### 9.2 준비·backup

1. 운영자 동의하에 사용자별 row 수/최신 영속 block/중복 번호/깨진 참조/JSON 크기/지원 type/schema를 read-only preflight한다.
2. production MySQL backup과 실제 restore rehearsal을 통과한다. 백업 존재만으로 복구 가능하다고 판단하지 않는다.
3. desktop DB는 SQLite backup API 또는 모든 connection을 닫은 일관된 복사로 보존한다. 열려 있는 WAL DB의 본 파일만 복사하지 않는다.
4. 모바일 persisted 원문도 export한다. secret/token은 report·fixture·Git에 기록하지 않는다.
5. 기존 loader의 cross-user block collision·캐시 선반영 문제 때문에 DB와 로컬 표시 상태가 다른 경우 자동으로 서버/로컬 중 하나를 버리지 않는다. 계정별 보고 후 중단한다.

### 9.3 서버 backfill와 cutover

- expand migration은 새 테이블만 만든다. 기존 blocks/transactions/user_master를 drop/truncate/rewrite하지 않는다.
- 모든 v1 writer가 사용자 mode lock을 확인하는 bridge 서버를 먼저 배포한다. 이 fence를 모르는 옛 API 인스턴스는 모두 종료되어야 한다.
- cutover는 같은 sync_users row lock과 유지보수 상태로 v1 mutation·clear·deleteMismatch·commit bundle을 함께 막고, 진행 중 transaction이 끝난 뒤 시작한다.
- 사용자별 latest persisted block을 직접 조회한다. (uid,block_number) 중복 또는 모순된 hash/state는 임의 LIMIT 1로 선택하지 않고 차단한다.
- block.state가 정상일 때 categories → tasks → subtasks → relations로 평탄화한다. 기존 hash 재계산/replay는 필수 이관 경로로 사용하지 않는다.
- tasks.next에서 순서를 추출한다. head 1개, missing target 0개, multi-parent 0개, cycle 0개, 모든 task 방문을 확인한다. 빈 목록은 허용한다.
- 불완전 category/subtask 참조, map key와 내부 ID 불일치, 지원하지 않는 날짜/반복 값은 원문과 오류만 보고하고 중단한다. 묵시적 drop/fix 금지.
- 스테이징 계정 영역에 저장하고 원본 field별 canonical 비교·entity ID set·관계 set·순서·건수·내용 checksum을 검증한다.
- 이관 run과 원본 checksum이 같으면 재개 가능, 달라지면 이전 결과를 덮지 않고 새 검토가 필요하다.
- 최종 transaction에서 v2 epoch/initial seq와 mode를 공개한다. 성공 전에는 v2 writer를 열지 않는다.
- 초기 migration은 한 번의 baseline snapshot으로 bootstrap한다. 오래된 모든 event를 v2 delta로 복제할 필요는 없다.
- 기존 테이블과 cutover 시점 user별 legacy transaction identity 목록은 보존한다. 모든 계정 완료와 승인된 보관 기간 후에만 별도 삭제 작업을 논의한다.

### 9.4 Desktop local/outbox 변환

- 최초 기동은 legacy syncer를 시작하기 전에 capabilities와 migration marker를 확인한다. 마이그레이션 중 구 overwriteRemoteStateWithLocal 경로는 절대 실행하지 않는다.
- 원본 local DB를 백업하고 읽기 전용으로 분석한다. root auth/account DB와 task DB를 구분한다.
- local block_number가 server last보다 큰지만으로 pending을 결정하지 않는다. fork 때문에 같은 번호에 다른 변경이 있을 수 있다.
- (user,legacy tx hash)와 canonicalized transaction content/type을 서버 보존 원장과 비교한다. hash만 일치하고 내용이 다르면 차단한다.
- 이미 서버에 반영된 transaction은 다시 mutation으로 보내지 않는다. 판정된 미반영 transaction은 원래 local 순서대로 새 outbox로 변환한다.
- legacy initialize/full-state replacement는 서버 초기화로 번역하지 않는다. 공통 base가 검증된 경우에만 field/create/delete diff로 변환하고, base가 없으면 recovery export와 사용자 확인으로 넘긴다.
- 미동기화 local-only 계정도 새 DB에 보존한다. 나중에 서버 계정에 연결할 때 UID 자동 합치기/전체 서버 덮어쓰기는 금지한다.
- 과거 반복 완료로 만들어진 로컬 UUID와 서버 생성 UUID가 다르면 관련 객체·후속 mutation 참조를 함께 매핑한다. 대응이 모호하면 자동 replay하지 않는다.
- source fingerprint + stable legacy identity로 import ID를 정해 여러 번 재시작해도 중복 queue가 생기지 않게 한다.
- 서버 snapshot을 confirmed 상태로 설치하고 검증한 pending만 UI 위에 재적용한 뒤 atomic migration marker를 남긴다.
- marker 완료 전 crash는 원본으로 재시작 가능, 완료 후에는 구 엔진 재진입 금지. 원본 backup은 자동 삭제하지 않는다.

### 9.5 Mobile 조회 프로토콜 전환

사용자가 모바일은 조회 기능만 사용한다고 확인했다. 모바일 쓰기 데이터 migration·outbox·offline CRUD는 이번 범위에 포함하지 않는다.
hooks/websocket와 Home 조회를 capabilities → v2 snapshot → delta pull로 연결하고 기존 화면 모델로 변환한다.
삭제·순서·카테고리 관계 변경도 desktop과 동일한 v2 계약으로 화면에 적용한다. 새 데이터를 받기 전에 기존 조회 화면을 비우지 않는다.
AsyncStorage는 서버 원장이 아닌 조회 캐시다. schema/protocol tag가 다른 캐시는 원본을 보존한 채 새 snapshot으로 교체할 수 있다.
모바일 캐시와 cursor는 하나의 versioned envelope로 저장하고 검증한다. 일관성이 불명확하면 cursor만 재사용하지 않고 full snapshot으로 복구한다.
백그라운드·재접속에서 delta를 보완하고 로그아웃/계정 전환 때 캐시·cursor의 UID를 분리한다.
v1 계정은 기존 조회, v2 계정은 새 조회 adapter를 사용한다. 구 모바일의 변경 없는 호환 보장은 구버전 정책에 따른다.

### 9.6 Rollback 경계

- v2 쓰기 개방 전: 실패한 staging을 비활성화하고 보존된 v1으로 복귀 가능. 원본은 그대로 둔다.
- v2 쓰기 개방 후: feature flag만 legacy로 돌리면 이후 변경이 사라진다. 단순 rollback 금지.
- 이때는 v2 writer를 멈추고 snapshot/outbox를 보존한 뒤 forward fix를 우선한다. v1 복귀가 필요하면 v2 canonical→legacy export와 모든 기기 pending reconciliation을 별도로 검증한다.
- 백업 restore는 v2 변경 유실 범위를 보고하고 명시적 승인 후 운영자가 시행한다. 이 설계 작업은 운영 DB 실행 권한을 의미하지 않는다.

## 10. 영향 모듈과 구현 순서

| 단계 | 대상 | 완료 게이트 |
| --- | --- | --- |
| P0 설계 | 이 문서, project.md, plans.md, tasks.md | 구버전 정책 승인, 요구사항 trace 검토 |
| P1 baseline/preflight | API chain/loader 테스트, legacy fixture·export validator, migrations runner | 유저 중복 번호·깨진 상태 검출, backup restore rehearsal 준비. production 적용 없음 |
| P2 서버 v2 | service/sync 새 package, controllers/v2, canonical migrations, core/main mode routing | idempotency·원자성·tenant isolation·field merge·order/recurrence 통합 테스트 |
| P3 sync·retention | push/pull/snapshot, WS, receipt/device 관리 | ACK 유실·seq gap·reconnect·stale cursor·snapshot/prune 경쟁 검증 |
| P4 desktop | database.context, syncer.context, executor.service, executors, websocket.context, IPC, Root.layout, task 정렬 consumers | 새 SQLite/adapter, 기존 데이터·pending 보존, offline→online 다기기 확인 |
| P5 mobile 조회 adapter | hooks/websocket, hooks/executor, Home, stateSlice, persistence | v2 snapshot/delta 표시, 삭제·순서 반영, 재접속·계정별 cursor 검증. 편집/outbox 제외 |
| P6 rehearsal | 격리 MySQL + SQLite 사본, failpoints, metrics | 사용자별 내용·관계·순서 parity, migration crash/resume, 롤백 경계 검증 |
| P7 opt-in rollout | bridge release, per-user migration CLI, mode fence | 운영자 별도 실행 승인, 구버전 재연결 보호, 관측 후 확대 |

기존 도메인 action 명칭은 UI와 IPC adapter에서 최대한 유지한다. canonical 엔진이 안정화되기 전 old state package를 삭제하지 않는다.
legacy user는 old path, v2 user는 new path이며 하나의 계정에서 두 writer가 경쟁하지 않게 한다.
새 설정 후보는 SYNC_V2_ENABLED=false, SYNC_LOG_PRUNE_ENABLED=false이며 실제 env는 수정하지 않는다. 구현 단계에서 example/Compose에만 추가한다.
계정 mode는 DB 원장으로 관리하고 전역 flag를 껐다는 이유로 v2 계정을 자동 v1 fallback시키지 않는다.
알 수 없는 protocol/server 오류 시 로컬 데이터를 유지하고 동기화만 보류한다.

## 11. 검증 매트릭스와 성공 기준

| 시험 | 반드시 확인할 결과 |
| --- | --- |
| 동일 ID 동시 retry + commit 후 ACK 유실 | canonical 변화·회차 생성·로그 1회, 동일 receipt |
| 서로 다른 프로세스의 같은 user write | seq 순서와 commit visibility 일치, gap 영구 누락 없음 |
| canonical 갱신 후 강제 log insert 실패 | 전부 rollback, 성공 ACK·메모리 선반영 없음 |
| A.title/B.done, A.title/B.title | 독립 필드 보존, 동일 필드 최종 server seq 승리 |
| delete와 offline patch / 부모 삭제·subtask create | 부활 없음, 참조 무결성, 실패 pending 복구 가능 |
| 같은 recurring generation 두 기기 완료 | 완료 instance 1개, 후속 참조 일치 |
| reorder 경쟁·삭제된 anchor·rank 소진 | cycle 없는 일관된 순서, 무효 anchor 설명, rebalance 원자성 |
| outbox commit 직후 kill / ACK 직전 kill | 재시작 후 편집 보존, 재전송 중복 없음 |
| pull 중 신규 write / full snapshot 중 write·prune | cursor의 일관된 prefix, snapshot S 이후 누락 없음 |
| retention 초과 offline device + pending | full sync 후 pending 유지·merge, receipt 잊어서 중복 생성하지 않음 |
| 사용자별 같은 block_number / 잘못된 JSON·링크 | 올바른 사용자만 이관, 모호한 원본은 차단 |
| migration 단계마다 crash/resume | 재실행 결과 동일, 원본 무손실, 완료 marker 원자성 |
| 구 client와 오래된 API 프로세스 | cutover fence 우회 불가. 미전환 계정은 기존 기능 유지 |
| 모바일 조회 | snapshot·delta·삭제·순서·계정 전환·재접속 시 최신 표시. 편집/offline mutation 시험 제외 |

synthetic fixture로 task 1k/10k/50k, mutation 100k를 비교한다.
단일 title 수정은 해당 entity와 작은 receipt/log만 기록하며 다른 task 수에 따라 payload가 증가하지 않아야 한다.
기록: DB byte 증가/변경, 네트워크 bytes/변경, p50/p95 write latency, API RSS/startup, snapshot 시간·최대 메모리, migration duration/lock wait.
부하 기준과 목표값은 baseline 측정 후 결정한다. 아직 성능 개선을 실측했다고 보고하지 않는다.
실제 Google 로그인·로컬 계정·tray/UI 기존 회귀도 client 단계에 포함한다.

## 12. 참고 근거

사용자별 잠금은 MySQL [Locking Reads](https://dev.mysql.com/doc/refman/8.0/en/innodb-locking-reads.html)의 transaction row lock을 이용한다.
snapshot은 [Consistent Nonlocking Reads](https://dev.mysql.com/doc/refman/8.0/en/innodb-consistent-read.html)의 동일 read view를 이용하며 HTTP 페이지마다 새 snapshot을 만드는 방식이 아니다.
열린 SQLite 파일은 [SQLite Backup API](https://www.sqlite.org/backup.html) 등 일관된 백업 방식이 필요하다.

## 13. 승인된 실행 경계

사용자가 account별 opt-in 및 구버전 sync 차단·업데이트 후 pending import 방식을 승인했다.
추가 요청에 따라 서버와 desktop의 schema version을 앱·동기화 protocol 버전과 분리하고, 연결 준비 시 자동 migration을 실행한다.
구조적 schema 준비는 자동화하되 account 데이터 backfill·v2 writer 개방은 preflight/rehearsal 이후 운영자가 승인한다.
구현과 운영 적용은 별개다. 현재 사용자 DB/운영 서버에 migration을 실행하지 않았다.
실행기 사용·실패 복구 원칙은 [Schema migrations](../schema-migrations.md)를 따른다.
