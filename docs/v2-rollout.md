# v2 일괄 배포 — 운영자 실행 절차

정책 갱신: 2026-09-06 04:17 KST

가짜 데이터 검증 완료: 2026-09-06 04:25 KST

## 실행 권한과 현재 상태

운영 DB 백업·마이그레이션·배포는 **사용자가 직접 실행**한다. 2026-09-07 사용자 승인에 따라 제공된 SQL 백업 사본의 로컬 격리 복원·리허설은 Codex가 수행한다. 운영 DB/DSN·실제 env·로그에는 접근하지 않으며 개인정보 원문을 출력하지 않는다.
이 문서는 실행 준비물이다. 운영 환경에서 아래 명령을 실행한 상태가 아니다.

계정별 opt-in은 사용하지 않는다. 이번 서버는 v2 sync만 제공하며 v1 sync endpoint는 HTTP 426 UPDATE_REQUIRED를 반환한다.
인증/Google 로그인 URL의 /v1은 유지된다. 인증 API 버전과 데이터 sync protocol은 별개다.
구 상태 조회용 /v1/test/*의 등록된 진단 endpoint도 410으로 종료하며 legacy Chain을 메모리에 로드하지 않는다.
SYNC_V2_ENABLED=false는 v2 동기화 일시 정지이며 v1 복귀 스위치가 아니다.

## 이관 도구

이미지에 /app/thread-sync-migrate를 포함한다. 로컬 Go 환경에서는 services/api에서 go run ./cmd/sync-migrate로 같은 도구를 실행할 수 있다.

| 명령 | 동작 |
| --- | --- |
| --prepare-schema | schema 5까지 준비. 데이터 이관은 하지 않는다. |
| --check-all | 전체 legacy 계정의 영속 원장을 읽기 전용 검사한다. |
| --apply-all | 전체 legacy 계정을 이관한다. 이미 v2인 계정은 건드리지 않는다. |
| --verify-all | 전체 사용자에 유효한 v2 mode/epoch가 있는지 읽기 전용 검사한다. |

DSN은 THREAD_MIGRATION_DSN 환경 변수로만 받는다. dotenv 파일을 자동으로 읽지 않는다.
도구는 사용자 UID·할 일 내용·DSN을 출력하지 않고 계정 건수와 실패한 계정의 정렬 순번만 출력한다.
실패 순번은 운영자가 자신의 DB에서 user_master를 uid 순서로 확인해 식별한다. 원문을 대화에 공유할 필요 없다.

쓰기 명령에는 --backup-confirmed와 --writers-stopped가 모두 필요하다.
이 플래그는 **백업을 대신 만들거나 writer를 실제로 정지시키지 않는다.** 복원 가능한 백업과 모든 구 API writer 종료를 운영자가 확인했다는 선언이다.

## 사용자가 실행할 순서

1. 운영과 격리한 임시 MySQL에서 제공된 백업 사본으로 먼저 rehearsal한다. 별도 서버는 필요하지 않다. 이번 사본의 결과는 [리허설 보고서](reports/2026-09-07-backup-migration-rehearsal.md)를 참고한다.
2. 배포할 코드·클라이언트 배포물을 준비하고 이미지를 build한다. 아직 새 API를 시작하지 않는다.
3. 운영자가 유지보수/쓰기 차단 구간을 정한다. 모든 API writer와 가입 등 계정 목록을 변경하는 요청을 멈춘다. 구 API 프로세스가 다른 호스트에 남아 있어도 안 된다.
4. 운영자가 DB 백업을 만들고 복원 가능성을 확인한다. backup 파일·실제 DSN은 비공개로 보관한다.
5. 같은 MySQL에 접근 가능한 DSN을 THREAD_MIGRATION_DSN에 설정한다. 컨테이너 안에서 DB_HOST는 보통 mysql이며 localhost가 아니다.
6. 아래 명령을 **하나씩 실행하고 종료 코드가 0인지 확인**한다. 실패하면 다음 단계로 진행하지 않는다.

EC2의 저장소 루트에서, 기존 mysql/redis만 유지하고 API writer가 종료된 상태의 예시. 현재 운영은 root .env를 사용하므로 --env-file을 지정하지 않는다:

```sh
docker compose build app-server

docker compose run --rm --no-deps -e THREAD_MIGRATION_DSN app-server ./thread-sync-migrate --prepare-schema --backup-confirmed --writers-stopped

docker compose run --rm --no-deps -e THREAD_MIGRATION_DSN app-server ./thread-sync-migrate --check-all

docker compose run --rm --no-deps -e THREAD_MIGRATION_DSN app-server ./thread-sync-migrate --apply-all --backup-confirmed --writers-stopped

docker compose run --rm --no-deps -e THREAD_MIGRATION_DSN app-server ./thread-sync-migrate --verify-all
```

-e THREAD_MIGRATION_DSN은 호스트에 설정한 값을 전달한다. 위 명령문에 비밀 DSN을 직접 적지 않는다.
기본 제한 시간은 전체 명령당 30분이며 필요하면 --timeout=2h처럼 명시한다. 최대 24시간이다.

7. 성공 확인 후 운영자가 root env의 SYNC_V2_ENABLED=true, SYNC_LOG_PRUNE_ENABLED=false를 설정한다. 실제 env는 Codex가 수정하지 않는다.
8. 새 API/RMS/site/admin을 운영자가 시작한다. 기존 compose 서비스명 기준 예시는 아래와 같다.

```sh
docker compose up -d app-server rms site admin-site
```

9. 클라이언트 업데이트를 배포하고 본인이 로그인·데이터·순서·오프라인 미전송 변경을 확인한다.
10. 백업 및 legacy blocks/transactions를 유지한다. 이 도구는 원본 테이블을 삭제하지 않는다.

새로 가입하고 legacy 이력이 전혀 없는 빈 계정은 첫 v2 접속 시 자동 준비된다.
기존 이력이 남아 있는 미이관 계정은 ACCOUNT_MIGRATION_REQUIRED로 차단하며 서버가 몰래 자동 이관하지 않는다.

## 원자성·재실행·실패

- 전체 배치는 먼저 모든 legacy 계정의 preflight를 통과시킨다. 각 계정은 다시 원장을 읽고 검사한 뒤 이관한다.
- category → task → subtask → 관계를 저장하고 DB에 읽어온 필드와 계획, 건수를 비교한다.
- 데이터 + source/rows checksum 이관 기록 + epoch/mode 공개는 계정 하나의 transaction이다.
- 전체 계정을 묶는 단일 초대형 transaction은 아니다. 중간 실패 시 앞서 완료한 계정은 유지되고 실패 계정은 rollback된다.
- writer를 정지한 상태에서 원인을 확인하고 같은 --apply-all을 다시 실행하면 완료 계정을 건드리지 않고 이어간다.
- 성공 응답을 잃어도 재실행이 기존 v2 데이터·epoch를 덮어쓰지 않는다.
- schema DDL 중 실패하여 ledger가 applying이면 무조건 재시도하거나 ledger를 삭제하지 않는다. [schema 실패 절차](schema-migrations.md)를 따른다.
- 새 v2 쓰기를 받은 뒤 backup을 덮어씌우거나 구 서버로 단순 rollback하면 새 변경을 잃을 수 있다. 먼저 쓰기를 멈추고 데이터를 보존해 forward fix를 검토한다.
- --verify-all은 전환 상태 점검이지 모든 운영 데이터의 의미적/화면적 무결성을 증명하는 도구는 아니다. 실제 사본·클라이언트 확인은 운영자가 수행한다.

## Desktop 데이터

업데이트된 desktop은 기존 SQLite를 백업하고 로컬 변경을 보존한 뒤 v2 DB/outbox로 자동 이관한다.
서버에 반영된 transaction은 다시 보내지 않고, 검증 가능한 pending만 원래 ID/순서로 가져온다.
fork·원장 불일치·미기록 local-only 변경·모호한 반복/초기화는 자동으로 버리지 않고 복구 검토 상태로 남긴다.
따라서 안전하게 판정할 수 없는 손상/예외 데이터까지 무조건 성공 처리한다는 의미의 자동 이관은 아니다.

## 수행한 검증 / 수행하지 않은 작업

가짜 계정만 들어 있는 격리 MySQL 8 tmpfs에서 schema 4→5, 전체 CLI 흐름, read-only check, 의도적 저장 실패 rollback, 재실행, v2 수정값·epoch·legacy 원문 보존, 빈 신규 계정 준비를 검증했다.
Go 전체 테스트·API/도구 컴파일 및 구버전 요청의 DB/외부 인증 접근 없는 426 응답을 확인했다.
추가로 2026-09-07 승인된 SQL 백업 사본을 격리 MySQL에 복원하여 schema5 준비·전체 이관·검증·재실행과 원본 행 보존을 확인했다. 운영 DB·사용자 SQLite·로그·실제 env에는 접근하거나 이관을 실행하지 않았다. 실제 기기/운영 검증은 사용자 담당으로 남는다.
