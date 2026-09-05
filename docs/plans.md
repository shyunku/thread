# Sync v2 구현 계획

작성: 2026-09-05 21:00 KST
브랜치: `refactor/canonical-sync-v2`
설계: [Canonical Sync v2](designs/canonical-sync-v2.md)
원문: [요구사항](patch260830.md)

## 진행 원칙

현재 확정 정책(#31): opt-in 없이 v2를 일괄 배포한다. 운영 DB 백업·검사·이관·배포는 사용자가 직접 수행하며 Codex는 가짜 데이터로 도구만 검증한다. 구버전 sync는 일괄 차단한다. 아래 단계표의 계정별 전환 표현보다 [최신 운영 절차](v2-rollout.md)를 우선한다.

현재 런타임은 v1이다. 이 계획 작성은 운영 DB 이관이나 파괴적 정리를 실행했다는 뜻이 아니다.
Electron 유지, Desktop offline-first 쓰기·다중 기기 sync 보존, Mobile은 조회 프로토콜만 v2로 변경한다.
실제 상태와 완료 이력은 [tasks.md](tasks.md)에서 관리한다.

## 구현 단계

| 단계 | 작업 | 먼저 확보할 증거 | 허용되는 전환 |
| --- | --- | --- | --- |
| 0 | 현 구조·schema·protocol·migration 설계 | 코드 기반 영향 분석과 구버전 정책 승인 | 새 브랜치 문서만 변경 |
| 1 | legacy fixture·read-only validator·migration runner 설계 | cycle/중복 block/tenant 충돌/깨진 참조 검출, 원본 무변경 | 격리된 fixture·DB 사본 |
| 2 | canonical schema + mutation engine | MySQL 실제 transaction/failure injection, idempotency·merge·반복·순서 테스트 | 기본 비활성 새 서버 경로 |
| 3 | push/pull·snapshot·receipt·retention | gap/ACK 유실/동시 write/prune·snapshot 경합 복구 | synthetic 다기기 테스트 |
| 4 | desktop SQLite migration·outbox·adapter | local-only 계정, 기존 데이터와 미전송 변경 보존, 재시작·복구 | 사용자 확인 후 테스트 기기 |
| 5 | mobile read adapter | 동일 v2 snapshot/delta/삭제/정렬·재접속 갱신 | 조회 전용. 새 편집 기능 없음 |
| 6 | 사본 rehearsal·성능 비교 | backup restore, migration resume, entity parity, 1k/10k/50k fixture 지표 | 계정 단위 전환 후보 선정 |
| 7 | 운영자 실행 일괄 cutover | 백업/복원 확인, 구 API writer 종료, 전체 이관/verify, rollback 경계 | 사용자가 직접 전체 계정을 이관하고 v2 서버 배포 |

## 미확정 정책

- **구버전 호환성(승인 완료):** 전환 계정의 v1 sync 차단 + 업데이트 후 보존된 legacy pending import. 수정하지 않은 구버전과 양방향 동시 쓰기 호환 engine은 제외한다.
- **자동 schema migration(추가 요청):** 서버와 desktop에 각각 version/checksum ledger를 두고 시작 시 실행한다. 앱 버전·protocol 버전과 분리하며, schema 준비만으로 account sync를 전환하지 않는다. #30에서 기반을 구현한다.
- **실제 사용자·기기 현황:** 운영 데이터·기기별 미전송 변경 존재 여부는 아직 조사하지 않았다. 운영자와 함께 preflight에서 확인한다.
- **반복 작업 날짜:** 기존 Go/JavaScript 간 월말·윤년·시간대 동작을 비교한 뒤 기존 의미를 유지하는 명세 확정. 이관 중 일괄 시간대 변환 금지.
- **rank 재간격화:** 수만 개 entity에서 잠금 시간·전송 크기를 측정한 뒤 operational limit 확정.
- **retention:** 90일은 후보값, 초기 자동 prune 비활성. 보존 기간·백업 정책 확정 후 활성화한다.

## 중단 조건

#24의 canonical 엔진에 #25 HTTP/WS·snapshot·retention과 schema 4를 연결했다. #26 desktop outbox/이관 adapter와 #27 모바일 조회 adapter의 [구현·검증 게이트](sync-v2-implementation.md)를 기록했다. 운영 계정 전환은 수행하지 않았으며 클라이언트 실제 기기 검증은 대기 중이다.

#23의 읽기 전용 이관 기반과 실행·검증 범위는 [Legacy sync preflight](sync-preflight.md)에 기록한다. 이 도구의 성공은 실제 계정 이관 완료를 의미하지 않는다.

모호한 최신 block, 손상된 링크/참조, 서버·로컬 상태 불일치, 대응 불가능한 legacy 반복 작업 ID, backup 복구 실패가 있으면 해당 계정을 이관하지 않는다.
원본을 버리거나 서버 상태로 무조건 덮어쓰지 않는다.
v2 쓰기를 받은 뒤 단순 flag rollback을 하지 않는다. 새 변경을 보존한 forward fix 또는 검증된 역이관이 필요하다.
실제 로그인·복수 기기·운영 migration 등 사용자 참여가 필요한 단계에서는 자동 완료 처리하지 않고 멈춰 결과를 요청한다.
