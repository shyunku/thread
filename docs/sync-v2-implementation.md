# Sync v2 implementation and validation gate

갱신: 2026-09-06 02:15 KST

브랜치: `refactor/canonical-sync-v2`

관련 작업: #25 서버, #26 desktop, #27 mobile 조회

## 현재 상태

서버 transport와 클라이언트 adapter를 구현했다. 서버/SQLite/모의 transport 검증과 desktop production build는 통과했다.
실제 Google 로그인·다중 기기·절전 복귀·Android/iOS 화면은 이번 작업에서 실행하지 않았다.
#26/#27은 사용자 검증 대기로 WIP를 유지한다. 모바일 전체 TypeScript 검사는 기존 TS 4.8 / 설치된 Node 타입 선언 문법 불일치로 실패한다.

실제 env·로그·사용자 SQLite·운영 DB는 읽거나 변경하지 않았다. 코드에 들어간 자동 이관은 향후 앱 실행 시 동작하는 경로이며, 사용자 계정을 이번에 전환했다는 뜻이 아니다.

## 서버

- schema **4**: immutable snapshot metadata/pages를 새로 추가한다. 기존 migration 1–3은 변경하지 않는다.
- `SYNC_V2_ENABLED=false`, `SYNC_LOG_PRUNE_ENABLED=false`를 root example와 Compose에 추가했다. 실제 env는 사용자가 관리한다.
- `/v2/sync/capabilities`는 비활성 상태에서도 account mode를 반환한다. 전역 flag가 꺼져도 v2 계정을 v1으로 되돌리지 않는다.
- Thread HS256 access JWT와 만료·UID·authorized claim을 검증한다. admin JWT와 Google provider token은 sync 사용자 인증으로 받아들이지 않는다. token을 URL에 넣지 않는다.
- `POST /devices`: 같은 account/device 재등록은 idempotent, revoked ID 재활성화 금지.
- `POST /push`: 1MiB/100 mutation 제한. mutation별 atomic ACK, 첫 실패 이후 not_attempted. 중간 실패 이전에 commit된 항목이 있을 수 있으므로 모든 retry에서 원래 ID/본문을 유지한다.
- `GET /changes`: HMAC cursor가 UID/epoch/seq를 묶는다. 고정 high watermark, 논리 mutation 단위 페이지, gap 거절, 오래된 cursor는 410 RESET_REQUIRED.
- `POST /snapshots`, `GET /snapshots/{id}/pages/{page}`: 생성 완료 후 공개되는 고정 페이지. UTF-8 payload 문자열의 SHA-256 checksum을 검증한다.
- snapshot TTL 15분, account당 동시 4개, artifact 총 128MiB, 페이지 목표 1MiB, 개별 entity 최대 16MiB. 한 논리 delta는 분할 적용하지 않으며 pull byte budget은 20MiB다.
- snapshot은 account row lock을 먼저 잡고 동일 REPEATABLE READ transaction에서 canonical rows·seq를 읽어 pages와 retention pin을 commit한다. 초기 구현은 snapshot 생성 동안 해당 account writer가 기다린다. 대형 계정 lock 시간은 #28에서 측정해야 한다.
- `WS /connect`: 2초마다 DB high watermark를 확인해 invalidation을 보낸다. 프로세스별 in-memory broadcast에 의존하지 않아 다른 API instance의 commit도 감지한다. 최대 request lifetime/토큰 만료 시 연결을 닫고 클라이언트가 재접속·pull한다.
- prune은 명시적으로 호출하는 maintenance 함수만 제공하고 scheduler/public deletion endpoint는 두지 않았다. snapshot pin 이후 로그는 유지하며, 삭제 경계와 min_available_seq를 같은 transaction에서 갱신한다. receipts·occurrences·tombstones는 삭제하지 않는다.
- `GET /legacy-proof?epoch=...&base=...`: 보존된 원장을 read-only preflight로 검증하고 transaction provenance와 공통 base rows를 반환한다. legacy Chain cache를 재사용하지 않는다.

### 구버전 차단

모든 v1 socket handler가 sync_users row lock을 callback 종료까지 보유한다. v2/maintenance account는 UPDATE_REQUIRED로 거절한다.
다중 transaction bundle, deleteMismatchBlocks, clearStatePermanently도 같은 fence 아래에 있다. v2/maintenance account는 legacy 초기 Chain load에서 제외된다.
이 fence를 모르는 옛 API 프로세스가 남아 있으면 안전한 cutover가 아니다. 운영 전환 전에 모든 writer 교체가 필요하다.

## Desktop

새 DB는 `datafiles/sync-v2/user-{encoded-uid}.sqlite3`이다. 기존 root-v1/legacy v2 SQLite의 경로와 ID는 바꾸지 않는다.
schema `sync-v2:1`은 기존 migration runner와 별도 ledger scope를 사용하며, WAL/FULL과 transaction serialization을 적용한다.

- confirmed_entities / visible_entities: entity별 JSON row. 서버의 typed canonical table과 달리 로컬 adapter는 entity 단위 row payload로 저장한다. 변경할 때 전체 snapshot row를 새 history로 쌓지 않는다.
- outbox: stable device/clientChangeId, immutable request, local order, accepted/applied/rejected status, ACK와 preview 오류.
- recovery_items / legacy_imports: 원본·실패 이유·이관 provenance를 보존한다.
- SQLite transaction 안에서 편집과 outbox를 저장한 뒤 UI 모델을 갱신한다. remote base + pending 재적용과 cursor/자기 ACK 처리도 atomic이다.
- push ACK의 seq로 pull cursor를 점프하지 않는다. ACK가 유실되면 같은 ID 재시도 또는 자기 delta 수신으로 해결한다.
- full snapshot 실패·checksum 오류·gap·DB 오류 시 기존 confirmed state와 pending을 보존한다. epoch가 달라졌는데 pending이 있으면 자동으로 새 epoch에 재결합하지 않는다.
- visible/confirmed 영속화는 바뀐 entity row만 INSERT/UPDATE/DELETE한다. 현재 UI adapter와 rebase는 account rows를 메모리에서 비교하므로 O(n) 비용이 남는다. 대규모 성능 완료를 주장하지 않으며 #28의 측정 대상이다.
- 일반 create/patch/delete/관계/move는 optimistic view에 반영한다. 반복 완료는 intent를 durable queue에 보존하되, 서버 확정 전 임의의 다음 날짜/clone ID를 만들지 않는다. 대기 건수는 상태 바에 표시한다.
- 15초 reconciliation, WS invalidation, 절전 복귀 pull, access token refresh를 연결했다.
- capabilities 확인 전 legacy sync를 시작하지 않는다. 예전 서버가 capabilities를 제공하지 않거나 mode/epoch가 불명확하면 동기화만 보류한다.
- Renderer는 기존 Task/Category/Subtask 모델을 재사용한다. v2 mutation ACK는 기존 v1 action reducer에 다시 적용하지 않는다.

### 기존 데이터와 pending 이관

1. legacy SQLite의 VACUUM INTO 사본을 새 고유 backup 파일로 만든다.
2. 그 사본을 read-only로 읽고 row와 transaction 원문을 recovery storage에도 보존한다.
3. 원장의 UID/hash/version/type/content digest를 비교한다. local block number가 크다는 이유만으로 pending으로 분류하지 않는다.
4. 마지막으로 확인된 공통 base 위에서 pending intent를 순서대로 재현한다.
5. 결과의 ID·필드·부모·관계·task 순서가 로컬 사본과 정확히 일치해야 import한다.
6. 이미 반영된 항목은 재전송하지 않는다. 미반영 항목의 결정적 change ID/outbox/provenance와 완료 marker를 한 SQLite transaction에서 저장한다.
7. 반복 완료의 clone 매핑, legacy schedule 변경, 공통 base 없는 전체 initialize, fork, 원장/내용 불일치, 미기록 local-only field 변경은 자동 추정하지 않고 검토 상태로 남긴다. 원본과 backup을 삭제하지 않는다.

검토 상태는 UI에 안내하고 편집·전송·legacy overwrite/clear를 차단한다. generic recovery 항목을 자동 폐기하거나 강제 승인하는 버튼은 없다.
성공한 import의 원문도 남기며, source fingerprint가 바뀌면 이전 사본을 덮어쓰지 않는다.

## Mobile 조회

모바일 편집과 outbox는 추가하지 않았다.
capabilities에 따라 v1 조회 또는 v2 snapshot/delta 조회를 선택한다.
v2 데이터+UID+epoch+cursor를 checksum이 있는 단일 AsyncStorage envelope로 저장한다.
다운로드/저장 실패 시 기존 cache를 유지하며, 손상/이전 schema cache는 recovery key로 보존한다.
Redux에는 조회 결과를 atomic replacement로 적용해 삭제를 반영하고, owner UID가 다른 목록은 표시하지 않는다.
secret/locked/color/doneAt과 task 순서·부모·관계를 보존한다. WS, 15초 polling, foreground에서 갱신한다.

## 자동 검증

- API 전체 Go tests, 최종 API compile.
- 격리 MySQL 8/tmpfs: schema 2→4 upgrade, 중복/dirty/checksum migration, mutation engine 회귀.
- 격리 MySQL protocol: snapshot 불변성, 생성 이후 delta, 고정 H 페이지, stale cursor, pin/prune, ACK 유실/receipt 보존, tenant/epoch/device, legacy fence와 cutover 대기, legacy proof.
- 실제 localhost HTTP/WS: JWT, capabilities/device/snapshot, duplicate push, DB commit 이후 invalidation, pull.
- Desktop Node + SQLite 및 mobile 조회/Redux 테스트: 22개.
- Desktop renderer/Google 로그인 mock Jest: 18개.
- Desktop production build: 통과, 기존 lint 경고. 설치 파일 실행을 검증한 것은 아니다.
- example 기준 Compose config: 통과.
- Mobile TypeScript 전체 검사: TS 4.8이 node_modules/@types/node/ffi.d.ts의 새 문법을 해석하지 못해 실패. 새 adapter transpilation과 순수 로직 tests 통과가 native build/typecheck 성공을 대신하지 않는다.

재실행:

```powershell
node --test apps/desktop/tests/*.test.cjs apps/mobile/tests/readReplica.test.cjs
pnpm --dir apps/desktop exec react-scripts test --watchAll=false --runInBand
pnpm --dir apps/desktop run build
docker compose --env-file .env.example config --quiet
```

DB integration tests는 명시적인 빈 테스트 DB만 허용한다. THREAD_SYNC_TEST_DSN, THREAD_SYNC_HTTP_TEST_DSN, THREAD_CANONICAL_TEST_DSN, THREAD_MIGRATION_TEST_DSN을 사용하는 해당 tests의 prefix guard를 따른다.
운영 DSN 또는 Compose DB를 테스트용으로 재사용하지 않는다.

## 사용자 검증에서 멈추는 게이트

운영 account mode를 수동으로 v2로 바꾸지 않는다. schema 준비와 실제 데이터 backfill은 별개다.
먼저 격리 테스트 계정/앱 데이터 경로를 준비하고 아래 항목을 사용자와 확인해야 #26/#27을 DONE으로 바꿀 수 있다.

| 시나리오 | 기대 결과 | 실패 분류 |
| --- | --- | --- |
| 기존 Google 로그인 / 미전환 계정 | v1 동작과 기존 목록 유지 | AUTH / LEGACY_REGRESSION |
| desktop A offline 편집 후 앱 재시작 | 편집·미전송 ID 보존 | LOCAL_DURABILITY |
| A reconnect, B 동시 다른 필드 편집 | 둘 다 반영, cursor 누락 없음 | MERGE / CURSOR |
| 오래된 cursor + pending | snapshot 후 pending 유지 | RESET_PENDING |
| clone/반복·월말·정렬·삭제 | 중복 회차 없음, 올바른 순서/관계 | RECURRENCE / ORDER |
| 실제 legacy 사본 이관 | 필드/순서/pending parity, 원본 backup 유지 | MIGRATION_PARITY |
| 모바일 조회·삭제·계정 전환 | stale 삭제/타 계정 목록 미표시 | READ_CACHE_SCOPE |
| 절전/foreground·네트워크 단절 | 재연결 및 주기적 pull로 수렴 | RECONNECT |

#28의 사본 restore·부하 측정과 #29의 별도 운영 승인은 아직 수행하지 않았다.
