# Canonical mutation engine

작성: 2026-09-05 23:55 KST
브랜치: `refactor/canonical-sync-v2`
관련: [설계](designs/canonical-sync-v2.md), [schema migration](schema-migrations.md), [tasks #24](tasks.md)

## 구현 상태

`services/api/service/canonical`에 DB mutation 엔진을 추가했다.
**아직 HTTP/WebSocket/v1 handler에 연결하지 않았다.** 운영 계정 mode 변경이나 legacy block backfill을 수행하지 않았다.
다음 #25에서 push/pull·snapshot·device 등록·전달 및 접근 제어를 연결하고 #26/#27에서 클라이언트를 연결한다.

서버 schema 3은 tasks/subtasks/categories/task_categories와 sync_devices/sync_change_log/sync_receipts/sync_occurrences를 추가한다.
기존 schema 1·2의 SQL/checksum은 그대로 유지하고 새 migration만 추가했다.
API를 이 코드로 재기동하면 구조적 schema migration은 자동 적용되지만 기존 계정의 v2 writer는 켜지지 않는다.
운영 배포 전 backup/DDL 권한과 [migration 주의사항](schema-migrations.md)을 확인해야 한다.

## 원자성 및 권한 경계

`Store.Apply(ctx, authenticatedUID, mutation)`의 UID는 서버 인증 context에서 전달해야 한다. client body에서 가져오지 않는다.

1. sync_users의 해당 사용자 row를 FOR UPDATE로 잠근다.
2. mode=v2, epoch 일치, 같은 사용자에 등록되고 폐기되지 않은 device를 확인한다.
3. (user,device,clientChangeId) receipt를 검사한다.
4. SAVEPOINT 아래 mutation을 실행한다.
5. 성공한 변경은 canonical row·field version·한 개의 change envelope·last_seq·receipt를 한 transaction으로 커밋한다.
6. 도메인 오류면 SAVEPOINT까지 되돌리고 작은 거절 receipt만 커밋한다.
7. SQL/log/receipt 실패는 전체 rollback하며 성공 응답을 반환하지 않는다.
8. COMMIT 응답이 불명확하면 동일 ID로 재시도해야 한다.

사용자별 잠금은 process mutex가 아니라 MySQL row lock이다. 여러 connection/인스턴스에서도 같은 사용자 쓰기를 직렬화한다.
처리한 변경이 없거나 거절된 요청은 새 sequence를 소비하지 않는다.
이 모듈은 아직 WS를 보내지 않는다. 향후 전달은 반드시 COMMIT 이후여야 한다.
mutation 1개가 하나의 atomic unit이며, 여러 mutation batch의 정책은 #25에서 연결한다.

## 입력과 결과

```json
{
  "epoch": "canonical-lowercase-uuid",
  "deviceId": "canonical-lowercase-uuid",
  "clientChangeId": "canonical-lowercase-uuid",
  "entityType": "task",
  "entityId": "existing-task-id",
  "operation": "patch",
  "baseVersion": "17",
  "changes": {"title": "Updated title"}
}
```

- epoch/deviceId/clientChangeId는 canonical UUID 문자열이다. entity ID는 기존 문자열을 보존하며 최대 255 Unicode code point.
- entity ID는 case-sensitive이고 끝 공백을 잘라내지 않는다. SQL은 MySQL 8의 utf8mb4_0900_bin을 사용한다.
- version/seq/generation/rank는 decimal 문자열이다. float로 변환하지 않는다.
- scalar changes는 canonical snake_case 필드명이다. title/memo, done/done_at, due_date, repeat_period/repeat_start_at 등.
- legacy 날짜 규칙과 일치하도록 epoch milliseconds를 사용하고 날짜 없음은 0이다. 현재 nullable scalar는 제공하지 않으며 null을 보내 지우는 방식은 거절한다.
- created_at은 create에서만 설정할 수 있다. sort_rank/recurrence_generation은 서버 전용이다.
- done_at은 done과 함께 보내야 한다. done=true에 done_at을 생략하면 서버 처리 시각, done=false이면 0.
- 제목은 SQL TEXT 용량 내 최대 65,535 bytes, memo는 최대 1MiB이며 요청 전체도 최대 1MiB로 제한된다.

Result는 accepted/rejected, seq, code, conflictFields, generated ID mapping, duplicate 표지를 제공한다.
전체 Task state는 receipt에 복사하지 않는다. 실제 row 변화는 change_log의 changes 배열에서 받는다.
push ACK seq를 그대로 pull cursor로 삼으면 중간 변경을 건너뛸 수 있으므로 금지한다.

## 지원 동작

| 대상 | 동작 | 주요 규칙 |
| --- | --- | --- |
| task | create/patch/delete/move/completeRecurringTask | create의 categoryIds 연결과 선택적 anchorId/after 순서 배치도 같은 transaction |
| subtask | create/patch/delete | parentId=task ID, 부모가 존재하고 삭제되지 않아야 함 |
| category | create/patch/delete | 연결된 task가 있으면 CATEGORY_IN_USE |
| taskCategory | add/remove | parentId=task ID, entityId=category ID. 관계별 present/version 갱신 |

다른 필드는 현재 값을 유지한다. 같은 필드 충돌은 서버 처리 순서의 마지막 patch가 이긴다.
baseVersion 불일치만으로 전체 mutation을 거절하지 않는다. field_versions로 충돌 필드를 결과에 표시한다.
미래 baseVersion은 거절한다. 입력에 없는 필드를 결과적으로 바꾸는 도메인 그룹(done/done_at 등)은 함께 기록한다.

task 삭제는 subtask 및 연결 관계의 tombstone을 같은 change envelope에 넣는다.
삭제된 entity에 오래된 patch/create가 와도 자동 부활하거나 ID를 재사용하지 않는다.
관계 remove 후 add는 서버 순서에 따른 합법적 관계 변경이다.

## 재시도와 로그

같은 idempotency key + 같은 요청은 최초 receipt 결과를 반환한다.
같은 key로 내용을 바꾸면 IDEMPOTENCY_KEY_REUSED이며 다시 실행하지 않는다.
거절된 요청을 수정하려면 새 clientChangeId가 필요하다.
변경 로그 payload는 달라진 필드와 updated_at 및 entity identity/version을 담는다. create는 새 entity 필드를 담는다.
동일 논리 mutation이 같은 entity를 여러 번 수정하면 하나의 최종 change로 합친다. 따라서 같은 seq의 중간 patch를 클라이언트가 놓치는 문제가 없다.
receipt와 occurrence 기록은 log retention과 별도로 유지한다. prune 구현은 #25 이후 검증 대상이다.

## 정렬

linked-list pointer는 v2에서 갱신하지 않는다.
DECIMAL(65,0) rank를 큰 정수로 계산한다. 초기 간격은 2^32이며 두 이웃의 중간 rank를 할당한다.
같은 rank의 tie는 entity ID로 정한다. client는 rank가 아니라 anchorId와 after를 보낸다.
gap/범위가 소진되면 해당 사용자 live task를 같은 transaction에서 재간격화하고 rank delta를 기록한다.
현재 자동 재간격화 한도는 50,000 task다. 초과 시 ORDER_MAINTENANCE_REQUIRED로 거절하며 일부만 적용하지 않는다.
16MiB를 넘는 change envelope도 커밋하지 않는다. 대량 cascade/rebalance의 streaming/maintenance·부하 SLO는 #25/#28에서 검증한다.

## 반복 완료

현재 서버의 Go AddDate 의미를 유지한다. 예를 들어 1월 31일 + 1개월은 3월로 정규화될 수 있다.
기존 desktop의 moment 월말 처리와 다를 수 있으므로 #26에서 서버 결과를 기준으로 화면/optimistic 계산을 맞춰야 한다.
서버 시각의 location에서 calendar 계산하며 새 사용자 시간대 정책은 추가하지 않았다.

- 요청은 generation을 포함한다.
- 같은 (user,task,generation) 회차는 서로 다른 device에서도 한 번만 완료된다.
- 완료 Task/subtask ID는 사용자·원본 task·generation·child identity에서 결정한다.
- 완료 clone에 하위 작업과 카테고리 관계를 보존하고, 원본 task와 하위 작업은 다음 회차로 진행한다.
- 완료 시각은 완료 clone에 기록하고 활성 원본의 done/done_at은 false/0으로 초기화한다. v2 동작의 명시적 규칙이며 기존 DB 값을 이관 시 일괄 수정하지 않는다.
- 반복 주기/기준일/기한을 patch로 바꾸면 generation을 전진시켜 오래된 회차 완료가 새 회차에 잘못 적용되지 않게 한다.
- 이미 완료된 회차는 저장된 generated ID/seq를 반환한다. 같은 mutation ID 재시도는 일반 receipt로 먼저 처리한다.
- clone 생성·순서·관계·원본과 child 초기화·occurrence 기록은 모두 같은 DB transaction이다.

## 검증 결과

2026-09-05 23:49 KST에 운영 볼륨과 분리된 mysql:8.0 tmpfs DB에서 확인했다.

- 서로 다른 필드 병합, 동일 필드 충돌 표시 및 최종 서버 순서 적용.
- 로그 저장을 CHECK 제약으로 실패시켰을 때 canonical/seq/receipt 전체 rollback, 동일 요청 재시도 성공.
- task 생성 뒤 잘못된 category 연결의 부분 작업 rollback과 거절 receipt 보존.
- 8개 동시 mutation의 연속 committed seq와 같은 요청 동시 재시도의 단일 적용.
- 다른 사용자 동일 entity ID 격리, 잘못된 epoch·폐기 device 차단.
- 부모 삭제의 child/관계 tombstone, 재생성·부활 차단, 사용 중 category 삭제 차단.
- move와 소진된 gap의 재간격화.
- 반복 완료 clone·subtask 보존/초기화, 두 device의 같은 회차 생성 1회.
- title만 patch할 때 변경 없는 memo가 delta에 포함되지 않음.
- v2 mutation이 legacy blocks/transactions에 쓰지 않음.
- 기존 schema 2→3 자동 upgrade, no-op 재기동, checksum/downgrade/부분 DDL 실패 보호.
- 큰 정수 rank 정밀도·overflow, 입력 타입·필드·크기, 월말·윤년·KST calendar 단위 시험.
- API 전체 Go 테스트와 core 컴파일 통과.

실행:

```powershell
go test -vet=off ./...
```

MySQL 엔진 시험은 빈 thread_canonical_test_ 접두사 DB의 THREAD_CANONICAL_TEST_DSN을 명시해야 실행된다.
schema migration 시험은 별도 빈 thread_migration_test_ DB의 THREAD_MIGRATION_TEST_DSN을 사용한다.
변수 미지정 시 실제 DB 시험은 SKIP된다. 운영 DB나 .env를 테스트 원본으로 자동 선택하지 않는다.

아직 검증하지 않은 범위: HTTP/WS 전달·실제 desktop/mobile 연결·운영 데이터 backfill·대규모 성능/이관 rehearsal.
운영 계정은 전환하지 않았고 테스트 컨테이너만 검증 후 제거한다.
