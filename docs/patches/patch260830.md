Thread 서버의 현재 Task 저장/동기화 구조를 개선해줘.

## 배경

현재 서버는 Task를 일반적인 `tasks` 테이블에 저장하지 않고, 대략 다음과 같은 구조를 사용하고 있다.

```text
Transaction
  → Transition
  → 전체 State 재계산
  → Block 생성
  → transactions + blocks 저장
```

각 Block에는 `transitions`뿐 아니라 해당 시점의 **전체 State snapshot**까지 저장되고 있으며, `block_hash`, `prev_block_hash`, `tx_hash` 등을 사용하는 hash-chain 구조도 포함되어 있다.

이 구조는 과거에 event sourcing / blockchain 스타일로 설계한 것이고, 멀티 디바이스 동기화라는 목적 자체는 유지하고 싶지만 현재 방식은 지나치게 무겁고 복잡하다.

특히 걱정되는 부분은 다음과 같다.

- Task가 많아질수록 State 자체가 커진다.
- Task 제목 하나 변경 같은 작은 mutation에도 전체 State가 매번 저장된다.
- transaction 수에 비례해서 동일한 데이터 snapshot이 계속 중복된다.
- 장기간 사용하면 DB 용량이 매우 빠르게 증가할 가능성이 높다.
- Task를 SQL로 직접 조회/필터링하기 어렵다.
- block/hash-chain 구조가 실제 서비스 요구사항 대비 지나치게 복잡하다.
- 향후 서버/클라이언트 코드 유지보수가 어려워진다.
- 그렇다고 단순 CRUD 서버로 바꾸면서 현재의 offline-first / multi-device sync 특성까지 잃고 싶지는 않다.

## 목표

다음 구조로 리팩터링하고 싶다.

```text
Client Local DB
    ↕
Sync Engine
    ↕
Server
 ├─ canonical entity tables
 └─ change_log
```

핵심 원칙은:

1. 서버 DB에는 현재 상태를 일반적인 정규화된 테이블로 저장한다.
2. 변경 이력은 별도의 append-only change log에 저장한다.
3. 클라이언트는 cursor/sequence 기반 incremental sync를 한다.
4. 오프라인 변경을 지원한다.
5. 여러 디바이스에서 변경된 내용을 합칠 수 있어야 한다.
6. 동일 Task의 서로 다른 field 변경은 가능하면 자동 merge한다.
7. 동일 field의 충돌은 단순하고 deterministic한 정책으로 처리한다.
8. 현재처럼 매 transaction마다 전체 State를 저장하지 않는다.
9. blockchain/hash-chain 개념은 특별한 실익이 없다면 제거한다.

---

# 원하는 서버 저장 구조

우선 Task는 실제 테이블로 관리한다.

예:

```sql
tasks

id
user_id

title
memo
done
due_date
repeat_period

prev_task_id

created_at
updated_at
deleted_at

version
```

실제 현재 Task 모델을 분석해서 필요한 컬럼은 추가/수정해도 된다.

Category, Subtask 등 다른 entity도 동일한 원칙으로 별도 canonical table을 만드는 방향으로 검토해라.

Soft delete가 sync에 유리하다면 `deleted_at` 방식으로 사용한다.

---

# Change Log

별도의 변경 로그를 둔다.

예:

```sql
change_log

seq BIGINT
user_id
device_id

entity_type
entity_id

operation
payload

created_at
```

`seq`는 클라이언트 sync cursor로 사용할 수 있어야 한다.

예를 들어:

```json
{
  "seq": 10581,
  "entityType": "task",
  "entityId": "task-id",
  "operation": "update",
  "payload": {
    "title": "새 제목"
  }
}
```

처럼 전체 entity가 아니라 가능하면 **변경된 field만 저장**한다.

단, delete/create처럼 전체 entity가 필요한 경우에는 적절히 설계해도 된다.

---

# 멀티 디바이스 Sync

각 클라이언트는 마지막으로 적용한 서버 change sequence를 저장한다.

예:

```text
last_sync_seq = 10500
```

동기화 시 개념적으로:

```text
1. 로컬에서 발생한 pending changes PUSH
2. 서버가 mutation 적용
3. 서버가 각 mutation에 sequence 할당
4. client cursor 이후의 remote changes PULL
5. local DB에 적용
6. cursor 갱신
```

형태로 동작했으면 한다.

WebSocket을 유지해도 되고 기존 구조상 HTTP + WebSocket 혼합이 더 적절하면 그렇게 해도 된다.

온라인 상태에서는 서버 change를 WebSocket으로 즉시 push하고, 재접속 시에는 `last_sync_seq` 이후 변경분을 다시 받아 누락을 복구할 수 있어야 한다.

즉 WebSocket 메시지가 유실되어도 sync cursor를 기준으로 eventual consistency가 보장되어야 한다.

---

# Offline-first

Desktop/Mobile에서 네트워크가 끊겨도 Task CRUD는 가능해야 한다.

클라이언트는 로컬 DB에 즉시 mutation을 반영하고 별도의 pending queue를 유지하는 방식이 적절하다.

예:

```text
tasks
pending_changes
sync_state
```

pending change에는 최소한 다음 정보가 필요할 것으로 예상한다.

```text
client_change_id
device_id
entity_type
entity_id
operation
payload
base_version
created_at
```

동일 mutation을 네트워크 retry 과정에서 여러 번 전송해도 중복 적용되지 않도록 **idempotency**를 반드시 고려해라.

예를 들어 `client_change_id`에 unique constraint를 두는 방식 등을 사용할 수 있다.

---

# Conflict 처리

CRDT나 OT 같은 복잡한 collaborative text editing까지는 현재 필요하지 않다.

Thread는 Todo 앱이므로 우선 entity/property 단위 conflict resolution이면 충분하다.

예를 들어:

```text
Device A:
task.title 수정

Device B:
task.done 수정
```

처럼 서로 다른 field 변경은 모두 보존되어야 한다.

반면:

```text
Device A:
task.title = A

Device B:
task.title = B
```

처럼 동일 field를 동시에 수정한 경우에는 서버가 deterministic하게 해결하면 된다.

초기 구현은 다음 중 단순하고 안전한 방식을 선택해라.

- server-authoritative ordering
- field-level last-write-wins
- version + server sequence 기반 resolution

단순히 entity 전체를 LWW해서 다른 field 변경까지 날려버리는 방식은 피하고 싶다.

가능하면 **field-level merge**가 되도록 설계해라.

`updated_at`을 클라이언트 wall-clock timestamp만 믿어서 conflict를 해결하는 방식은 clock skew 문제가 있으므로 피하고, 가능하면 서버 sequence/version을 authoritative ordering에 사용해라.

---

# Version

각 entity에 `version`을 두는 것을 고려한다.

예:

```text
Task A
version = 17
```

클라이언트 mutation:

```json
{
  "entityId": "A",
  "baseVersion": 17,
  "changes": {
    "title": "hello"
  }
}
```

서버의 현재 version과 비교해서 concurrent modification을 판단할 수 있게 한다.

다만 단순히 version mismatch이면 mutation 전체를 reject하는 optimistic locking만 구현하지 말고, 실제 multi-device sync에 적합한 merge 전략을 설계해라.

---

# Change log retention / snapshot

현재처럼 매 transaction마다 전체 State snapshot을 저장하는 구조는 제거한다.

다만 change log가 영구적으로 무한 증가하는 것도 피하고 싶다.

따라서 다음을 검토해라.

```text
canonical DB = 현재 상태
change_log   = 최근 sync / history에 필요한 delta
snapshot/checkpoint = 필요하다면 드물게 생성
```

예를 들어 오래된 change log를 안전하게 compact/prune할 방법도 고려한다.

단, offline device가 매우 오래 접속하지 않았다가 돌아올 수 있기 때문에 단순히 오래된 log를 삭제하면 안 된다.

오래된 cursor를 가진 client라면:

```text
incremental sync 불가
→ full sync
→ 새로운 cursor 지급
```

하는 방식으로 fallback할 수 있도록 설계해라.

즉 change log retention 정책까지 고려했으면 한다.

---

# Ordering

현재 Task 순서는 `PrevTaskId` / linked-list 스타일로 관리되는 것으로 보인다.

이 부분도 분석해줘.

멀티 디바이스 환경에서 reorder가 빈번할 경우 linked-list 방식이 적절한지 검토하고, 필요하면:

- fractional indexing
- LexoRank 계열
- sortable rank string

같은 방식으로 변경하는 것도 검토해라.

단, 필요 이상으로 복잡한 CRDT ordering을 도입하지는 마라.

---

# Transaction

현재 Transaction 개념 자체는 완전히 버릴 필요는 없다.

기존처럼 클라이언트의 하나의 논리적 action을 transaction 형태로 표현하는 것이 도움이 된다면 유지해도 된다.

다만:

```text
Transaction
→ Transition
→ 전체 State
→ Block
```

구조가 아니라

```text
Client Mutation
→ validation
→ DB transaction
→ canonical rows update
→ change_log append
```

형태가 되었으면 한다.

canonical entity update와 change_log append는 반드시 **하나의 DB transaction으로 atomic하게 처리**되어야 한다.

즉 다음 상황은 절대 발생하면 안 된다.

```text
tasks update 성공
change_log insert 실패
```

또는 그 반대.

---

# 보장해야 하는 특성

최종 설계에서 최소한 다음은 보장해라.

### 1. Idempotency

같은 client mutation이 두 번 전송돼도 한 번만 반영.

### 2. Atomicity

canonical state 변경과 change log 기록이 동일 DB transaction 안에서 처리.

### 3. Ordering

각 user에 대한 server change ordering이 명확해야 함.

### 4. Incremental sync

cursor 이후 변경만 가져올 수 있어야 함.

### 5. Reconnect recovery

WebSocket event가 일부 유실되어도 reconnect 후 복구 가능.

### 6. Offline mutation

offline에서 만든/수정한 Task가 reconnect 이후 서버와 정상 merge.

### 7. Soft delete propagation

한 device에서 삭제한 entity가 다른 device에서도 삭제되어야 함.

### 8. Multi-device conflict

동일 entity의 서로 다른 field 변경을 불필요하게 덮어쓰지 않음.

### 9. Scalability

Task가 수천~수만 개이고 mutation history가 매우 많아져도 현재의 full-state-per-transaction 방식보다 저장 공간과 처리량 측면에서 확실히 개선되어야 함.

---

# 기존 코드 호환성

현재 `services/api` 코드 전체를 먼저 분석하고 기존 흐름을 최대한 이해한 뒤 변경해라.

특히 다음을 찾아서 영향 범위를 확인해라.

```text
Transaction
Transition
State
Block
Chain
ApplyTransaction
PreExecuteTransaction
SyncBlocks
CommitTransactions
DeleteMismatchBlocks
WebSocket transaction handling
Task transaction types
Category/Subtask transaction types
```

Desktop/Mobile 쪽에서 현재 sync protocol을 어떻게 사용하는지도 함께 확인해라.

서버만 바꿔놓고 기존 클라이언트가 깨지는 구조로 끝내지 말고, 필요한 protocol 변경까지 전체적으로 설계해라.

---

# 진행 방식

바로 대규모 코드를 수정하지 말고 먼저 현재 구조를 충분히 분석한 뒤 다음 순서로 진행해줘.

1. 현재 Task 저장 및 sync 구조 분석
2. 기존 구조에서 문제가 되는 부분 정리
3. 새 architecture 제안
4. DB schema 제안
5. sync protocol 제안
6. conflict resolution 정책 제안
7. migration 전략 제안
8. 영향을 받는 파일/모듈 목록 제시
9. 구현 단계별 계획 작성
10. 그 다음 실제 코드 수정

기존 기능을 최대한 유지하면서 단계적으로 migration 가능하도록 설계해라.

가능하면 한 번에 모든 것을 갈아엎기보다 feature flag / compatibility layer / migration phase 등을 이용해서 안전하게 전환할 방법을 선호한다.

---

# 중요한 판단 기준

이 프로젝트는 수백 명이 동시에 같은 문서를 편집하는 Google Docs 같은 시스템이 아니다.

주요 요구사항은:

```text
개인 사용자의 여러 디바이스
offline-first
빠른 local interaction
reliable sync
Task 단위 데이터
향후 일부 collaboration 가능성
```

정도다.

따라서 CRDT, Raft, blockchain, distributed consensus 같은 복잡한 기술을 단순히 멋있어 보인다는 이유로 도입하지 마라.

필요한 consistency guarantee에 비해 가장 단순한 구조를 선택해라.

이번 리팩터링의 핵심 목표는:

**현재의 멀티 디바이스/offline sync 장점은 유지하면서, blockchain 스타일의 full-state snapshot/hash-chain 구조를 제거하고 일반적인 canonical database + change log 기반 sync engine으로 단순화하는 것**

이다.
