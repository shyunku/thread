# Thread Project

## 목적

Thread는 데스크톱과 모바일에서 사용할 수 있는 개인 할 일 및 일정 관리 서비스다. 클라이언트의 변경 사항을 트랜잭션과 블록 형태로 기록하고 중앙 애플리케이션 서버를 통해 여러 기기 사이에서 동기화한다.

- 슬로건: `Track. Handle. Remember. Execute. And Deliver.`
- 서비스 도메인: `threadapp.kr`
- 신규 앱 식별자: 데스크톱 `kr.threadapp.desktop`, 모바일 `kr.threadapp.mobile`

현재 데스크톱 배포·검증 대상은 Windows x64이다. macOS 실기기·서명 검증은 후순위 #63으로 분리하며, Linux 데스크톱은 현재 지원 대상에 포함하지 않는다. 기존 비지원 환경의 안전한 실패 처리는 유지한다.

v3 데스크톱 클라이언트는 기존 v2 계정을 확인하면 데이터 보호 업데이트를 필수로 안내한다. v2 홈으로 계속 사용하는 선택지는 제공하지 않는다. 서버의 출시 전 v2 API 병행 지원은 구버전 클라이언트를 위한 것으로, 새 클라이언트의 v2 사용 허용을 뜻하지 않는다.

## 구성 요소

Desktop의 시각 기준은 사용자 참고 이미지 기반 charcoal/blue 테마다. 검색·작업 목록/캘린더 분할·공통 토큰과 접근성 기준은 [디자인 명세](designs/desktop-visual-refresh.md)에 정의하며, 기존 데이터 모델과 동기화 동작을 유지한다.

Desktop 보기 선택은 리스트(기본), 캘린더, 타임라인이다. 창 너비가 1100px를 초과하면 리스트와 캘린더 선택 모두 두 뷰를 함께 표시한다. 1100px 이하에서는 선택한 뷰만 표시하며, 크기를 변경해도 선택을 유지한다. 타임라인은 단독 보기를 유지한다.

Desktop 개발 실행은 Thread Dev 및 kr.threadapp.desktop.dev로 구분하고 Electron userData/sessionData를 appData/thread-dev로 분리한다. 개발 실행과 설치 앱을 동시에 사용할 수 있으며 각 환경 내부의 중복 실행은 차단한다. 설치 앱의 기존 저장 경로와 프로젝트 내부 개발 작업 DB는 이동하거나 삭제하지 않는다.

| 경로 | 역할 | 배포 형태 |
| --- | --- | --- |
| `apps/desktop/` | Electron + React 데스크톱 클라이언트 | 네이티브 패키지 |
| `apps/mobile/` | React Native 모바일 클라이언트(2.0, RN 0.87·TypeScript, #81에서 새로 생성) | Android 먼저, iOS는 #93 |
| `packages/e2ee/` | 데스크톱·모바일 공용 E2EE·동기화 프로토콜(#82). 각 앱이 `link:`로 연결하고 플랫폼 암호(libsodium·CBOR·SHA-256·HKDF·난수)를 주입 | 데스크톱 설치본에 포함, 모바일 번들에 포함 |
| `apps/web/site/` | React 공개 웹사이트 | Docker/Nginx 지원 |
| `apps/web/admin/` | React 관리자 대시보드 | Docker/Nginx 지원 |
| `services/api/` | Go/Gin 인증 및 상태 동기화 서버 | Docker 지원 |
| `services/rms/` | Node.js/Express 릴리스 관리 서버 | Docker 지원 |

## 데이터 흐름

1. 데스크톱에서 할 일, 하위 할 일, 카테고리를 변경한다. 모바일 2.0(#81~#93)은 데스크톱과 같은 v3 데이터로 조회·편집을 목표로 한다.
2. 클라이언트는 변경을 트랜잭션으로 만들고 로컬 상태에 반영한다.
3. 인증된 WebSocket 연결을 통해 애플리케이션 서버에 트랜잭션을 제출한다.
4. 서버는 사용자별 상태와 블록을 계산해 MySQL에 저장하고 연결된 클라이언트에 전파한다.
5. 클라이언트는 블록 또는 스냅샷을 받아 로컬 상태를 동기화한다.

## 저장·동기화 개선 방향

현재 배포 구현은 위의 block/state v1이다. 목표 구조는 canonical entity tables와 append-only delta change log, 사용자별 sequence cursor 기반 동기화다. Desktop의 오프라인 쓰기·미전송 변경과 기존 데이터는 보존한다. Mobile은 조회 전용으로 snapshot·증분 조회·재접속 프로토콜만 맞추며 편집용 outbox는 이번 범위 밖이다. Electron은 유지한다.

상세 schema·protocol·충돌·retention은 [Canonical Sync v2 설계안](initiatives/v2-sync/v2-sync-canonical-design.md), 단계별 실행은 [계획](plans.md)에서 관리한다. 현재 확정 정책은 v2 일괄 배포와 구버전 sync 차단이다. 계정별 opt-in은 폐기했다. 운영자가 비공개 환경에서 전체 서버 데이터 이관을 직접 실행하고, desktop 업데이트 시 local pending을 보존·이관한다. [운영자 실행 절차](initiatives/v2-sync/v2-sync-rollout.md)를 따른다.

이 절은 과거 v2 일괄 배포의 설계·이력을 설명한다. 현재 서버는 v3 sync만 등록하며 `/v2/sync` 라우트와 전용 설정은 제거했다. 오래된 클라이언트의 해당 요청은 별도 업그레이드 응답 대신 404가 된다. 운영 DB·백업·로그·실제 env는 사용자가 관리하고 기존 평문은 별도 승인 전까지 보존한다. 사용자가 명시적으로 제공한 백업 사본의 격리 리허설은 Codex가 원문 출력 없이 수행할 수 있다. [클라이언트 검증 게이트](initiatives/v2-sync/v2-sync-implementation.md)는 과거 기록으로 유지한다.

## v3 개발 (암호화 보관함)

현재 v3 출시·검증 우선순위는 Windows 데스크톱이다. 모바일 v2 실기기 회귀와 v3 암호문 조회·PC↔Mobile 연결은 #53에서 macOS #63과 함께 후순위로 관리하며, 데스크톱 출시 게이트의 선행 조건으로 두지 않는다. 공통 암호·서명 프로토콜과 기존 모바일 코드의 호환성은 유지한다.

신규 계정은 항상 v3 설정 대기 상태로 생성한다. 첫 로그인에는 기존 데이터 이관 대신 이 기기의 데이터 잠금·복구 자료·서명된 기기 등록·빈 암호화 저장소 활성화를 거친다. 서버는 배포 플래그 없이 v3 API를 등록하고 v2 sync 라우트를 등록하지 않으며 테스트용 v2 가입도 거부한다. 과거 평문 DB·백업과 이를 읽기 위한 격리 도구·스키마 이력은 삭제하지 않는다. 사용자가 운영 계정의 v3 전환 완료를 확인했으며 이후 배포 후 검증은 #64에서 추적한다. 모바일 v3 조회·기기 연결은 #53, Mac 실기기 검증은 #63에서 추적한다.

2026-09-23 16:28 (KST): 운영 전 계정별 v1/v2 평문 잔존량을 내용 없이 확인하는 읽기 전용 도구를 추가했다. 합성 MySQL의 평문·암호문 백업을 별도 DB에 복원하고 전체 행 해시를 대조했다. 서버 평문 정리 범위와 승인 조건은 [정리 계획](initiatives/v3-encryption/protocol/v3-plaintext-purge-plan.md)에 기록했다. 운영 purge 실행 코드는 미구현이며 [출시 검증 기록](reports/2026-09-23-v3-release-rehearsal.md)과 #57에서 계속 추적한다.

2026-09-23 16:28 (KST): 운영 전 계정별 v1/v2 평문 잔존량을 내용 없이 확인하는 읽기 전용 도구를 추가했다. 합성 MySQL의 평문·암호문 백업을 별도 DB에 복원하고 전체 행 해시를 대조했다. 서버 평문 정리 범위와 승인 조건은 [정리 계획](initiatives/v3-encryption/protocol/v3-plaintext-purge-plan.md)에 기록했다. 운영 purge 실행 코드는 미구현이며 [출시 검증 기록](reports/2026-09-23-v3-release-rehearsal.md)과 #57에서 계속 추적한다.

2026-09-22 20:56 (KST): 데스크톱 최초 설정·이관은 620×820 전용 창에서 잠금 설정→복구 자료 확인·서버 등록→명시적 이관 순서로 진행한다. 작은 화면에서는 작업 영역 안에 맞추고 세로 스크롤을 제공하며, 앱 진입 시 기존 창 크기를 복원한다. 잠금 설정에서 OS 인증만 쓰거나 비밀번호도 추가할 수 있다. 두 방식 모두 계정 복원을 위한 암호화 복구 파일과 별도 코드 확인이 필요하다. 설정 > 데이터는 상태와 작업별 보관함 메뉴를 분리한다. 복구/기기 연결/키 관리 기능은 이후에도 접근할 수 있다.

2026-09-28 12:19 (KST): 설정 창은 메인 창의 상·하 100px 여백 안에 맞추고 내용 영역에서 독립적으로 스크롤한다. 보호·동기화 상태와 관리 작업을 구분하며 기존 복구·기기 연결·백업·잠금 기능은 유지한다.

복구 파일의 기본 이름은 `thread_recovery.trec`이다. 최초 설정·키 회전·분실 복구에서 새로 저장하는 파일은 `.trec`을 쓰며, 열기 창도 `.trec`만 허용한다. 기존 `.thread-recovery` 파일은 내용 형식이 같으므로 필요한 경우 파일 이름의 확장자를 `.trec`으로 바꿔 사용할 수 있다.

API schema11은 signed batch를 `encrypted_records`에 vault별 SHA-256 digest로 공유 저장한다. schema12는 공유 SHA-256·참조·기존 digest·byte 일치를 모두 확인한 뒤 object/change/snapshot의 중복 BLOB 컬럼만 제거한다. 클라이언트가 받는 서명 원문은 그대로다. 구 API와 혼용하지 않으며 운영 적용·v2 평문 삭제·서명 배포는 수행하지 않았다. [측정과 배포 경계](reports/2026-09-22-v3-record-storage.md).

2026-09-10 21:14 (KST): 일반 앱 이관 화면·signed v3 원본 snapshot·readback 기반 local cutover, 새 복구 자료 확인을 선행하는 키 회전, 제한된 전체 pending 선택을 연결했다. 자동 운영 실행은 없으며 실제 DB 이관/전체 분실/모바일 조회/최종 기기 검증은 남아 있다. 새 updater는 승인된 내장 공개 root와 서명 catalog가 필요하고, 미설정이면 unsigned 다운로드로 우회하지 않는다.

2026-09-10 일반 데스크톱 진입에 계정별 v2/E2EE 저장소 선택과 잠금 화면을 연결했다. 암호화 보관함으로 확인된 계정은 재시작·오프라인에서도 암호화 저장소를 유지하며 평문 저장소로 자동 전환하지 않는다. production 코드에도 포함하지만 실제 DB 이관·운영 게이트 활성화·출시를 의미하지 않는다. 아래 초기 단계 기록의 앱 통합 미완료 범위 중 진입/잠금은 구현됐으며 이관 UI와 최종 사용자 검증은 남아 있다.

사용자 승인(2026-09-09): 모바일 Android 최소 지원을 API 23(Android 6)으로 변경한다. 이후 모바일 2.0(2026-10-04, #81)은 최신 React Native 0.87을 쓰므로 최소 지원이 API 24(Android 7.0)로 올라갔다. Android 실기기로 보안 키 저장소를 검증하며, 모바일 편집 UI는 범위에 추가하지 않는다. 최신 구현 및 미완료 경계는 [2026-09-09 체크포인트](reports/2026-09-09-e2ee-checkpoint.md)를 참조한다.

Desktop의 최소 macOS 버전은 사용자 승인으로 12 이상이다. 2026-09-08 사용자 승인으로 E2EE 개발 브랜치의 Windows 배포는 x64 전용으로 전환한다. 기존 appId·사용자 데이터 경로는 보존하고 ia32→x64 설치 덮어쓰기는 별도 검증한다. #46~48의 TUF·암호 포맷·암호화 저장소 실험 구현은 [체크포인트](reports/2026-09-08-e2ee-checkpoint.md)를 참조한다. 기존 앱 통합은 미완료이며 E2EE 활성화로 표시하지 않는다.

2026-09-08부터 [E2EE 패치](initiatives/v3-encryption/v3-design.md)를 기준으로 별도 브랜치 `feat/e2ee-vault`에서 개발한다. 계정별 보관함, 기기 승인·QR/키 파일 연결, 복구 키와 암호문 동기화를 목표로 하며 [#43~#57](tasks/done/0043.md)로 추적한다. 현재 데이터는 여전히 Sync v2 평문 구조이며 실제 운영 전환과 과거 평문 삭제는 사용자 검증 후 별도로 수행한다.

## Google 로그인

Google 인증 결과는 사용자 식별에만 사용하고, 연동된 서버 계정에는 Thread access/refresh JWT를 발급한다. 데스크톱은 서버가 반환한 UID로 로컬 계정을 연결하며 로컬 인증 저장 성공 후 로그인 상태를 갱신한다. 서버에 연동되지 않은 Google 계정은 가입 또는 계정 연동 후 다시 Google 로그인을 진행한다. 이 응답 계약 변경은 API와 데스크톱을 함께 배포해야 한다.

## 로그인 세션

로그인할 때마다 세션(ID `sid`)을 하나 만들고 access/refresh JWT에 넣는다. refresh는 쓸 때마다 새 토큰으로 바뀌고, 이미 쓴 refresh 토큰이 다시 오면 그 세션 전체를 끊는다(응답 유실 대비 30초 유예). access 토큰을 받는 모든 API는 세션이 살아 있는지 Redis에서 확인하므로 로그아웃·"다른 곳에서 모두 로그아웃"은 즉시 적용된다. 세션 상태는 Redis에만 있고 토큰 원문은 저장하지 않는다(SHA-256). #72

## 관리자 인증

관리자 대시보드는 `user_master` 또는 `admin_master`의 계정 행이 아니라 API 서버의 `ADMIN_ID`와 `ADMIN_PASSWORD` 환경 변수로 관리하는 단일 운영 계정을 사용한다. 관리자 웹은 비밀번호 원문을 전송하지 않고 기존 3단 SHA-256 파생값을 전송하며, API는 환경 변수로 같은 값을 계산해 고정 시간 비교한다. 발급된 JWT에는 서명된 관리자 권한 claim을 포함하고 refresh token은 Redis에서 관리한다.

실제 관리자 ID와 비밀번호는 저장소에 커밋하지 않고 Compose 실행 시 루트 `.env` 또는 배포 환경의 비밀 변수로 제공한다.

## 저장소 정책

v3 데이터 잠금 해제는 Windows Hello/Touch ID를 지원하고, 최초 설정 시 비밀번호 추가 여부를 선택할 수 있다. OS 인증만 선택하면 로컬 비밀번호 파일을 만들지 않는다. 비밀번호를 추가해도 OS 인증은 사용할 수 있다. 로그인 비밀번호/복구 코드와 구분하며 Thread 자체 PIN은 제공하지 않는다. 인증 취소 후 다른 방법을 자동 시도하지 않는다. 현재 Sync v2 데이터가 이미 암호화됐다는 의미는 아니다.

관련 구성 요소는 단일 Git 저장소에서 관리한다. 사용자 애플리케이션은 `apps/`, 백엔드 서비스는 `services/` 아래에 배치한다. 과거 독립 저장소의 커밋 이력은 모노레포 이력에 포함하며, 데스크톱과 모바일 앱은 Compose 대상에서 제외한다. Node.js 구성 요소는 프로젝트별 `pnpm-lock.yaml`을 사용해 설치와 lifecycle을 서로 격리한다.

환경 변수의 소유 범위도 실행 경계에 맞춘다. Compose로 실행하는 MySQL, Redis, API, RMS 및 웹 애플리케이션은 저장소 루트의 `.env`를 공유한다. 네이티브 데스크톱과 모바일 클라이언트는 각각 `apps/desktop/`과 `apps/mobile/` 아래의 환경 파일에서 공개 endpoint 및 플랫폼별 클라이언트 설정을 읽으며, 클라이언트 환경 변수에는 서버 비밀값을 저장하지 않는다.

## 배포 구조

운영 절차와 주의사항은 [운영 가이드](production.md)에 정리한다.

업데이트 신뢰 초기 정책(2026-09-10 17:29 KST): 최상위 root 키는 1개(threshold 1), 배포 키와 분리한다. 앱은 내장 공개 신뢰 정보로 검증하며 개인키를 포함하지 않는다. 운영 키 생성 및 배포는 별도 승인 대상이다. 이후 서명된 root 교체로 키 구성/threshold를 변경할 수 있다. [운영 경계](initiatives/v3-encryption/protocol/v3-update-signing-policy.md).

E2EE v3 서버 API는 별도 배포 플래그 없이 기본 등록한다. 이 사실만으로 기존 계정을 자동 이관하지 않으며, 계정 JWT와 기기 서명을 별도로 검사한다. 승인 만료·키 세대 회전·수신자 전용 키 전달 및 암호문 동기화의 구현 계약은 [E2EE v3 API](initiatives/v3-encryption/protocol/v3-api.md)에 기록한다. 운영 서명 업데이트와 배포 후 확인은 #64에 남는다.

이관 API는 운영 계정 집계에서 `sync_users.mode=e2ee` 1건, `vault_migrations.phase=ACTIVE` 1건, `user_master` 중 `sync_users` 누락 0건을 확인한 뒤 일반 v3 서버에서 등록을 종료했다. `E2EE_MIGRATION_ENABLED`도 제거한다. [prepare 계약](initiatives/v3-encryption/protocol/v3-migration-prepare.md)과 [upload/readback/CAS 활성화 계약](initiatives/v3-encryption/protocol/v3-migration-activation.md)의 구현·원본 보존 규칙은 복구를 위해 기록으로 유지한다. 기존 평문 DB와 백업은 삭제하지 않는다. [암호화 백업](initiatives/v3-encryption/protocol/v3-encrypted-data-backup.md) 가져오기는 원본 DB를 덮어쓰지 않는 복구 사본만 만든다.

공개 사이트와 관리자 사이트는 API 및 RMS와 함께 Docker Compose에 유지한다. 관리자 React 빌드의 공개 endpoint는 루트 env의 `ADMIN_APP_SERVER_ENTRY`와 `ADMIN_RMS_ENTRY`를 Compose build args로 전달해 local 및 production 값을 분리한다. 이 값은 정적 브라우저 번들에 포함되는 공개 설정이며 비밀값을 저장하지 않는다.

운영 환경에서는 EC2 호스트에서 실행하는 Cloudflare Tunnel이 `127.0.0.1`에만 게시된 site, admin-site, API 및 RMS 포트로 연결한다. 외부 TLS는 Cloudflare가 종료하고 private origin은 HTTP를 사용하므로 `USE_HTTPS=false`를 사용한다. `USE_HTTPS=true`는 Go API가 인증서 파일을 직접 읽고 TLS를 종료하는 배포에서만 사용한다. 실제 `.env`와 `.env.production`은 저장소에 커밋하지 않는다.

관리자 사이트의 릴리스 업로드는 Cloudflare의 단일 요청 크기 제한을 넘지 않도록 파일을 8MiB 청크로 순차 전송한다. RMS는 업로드별 메타데이터와 청크를 임시 저장하고 전체 청크의 존재 및 결합 파일 크기를 검증한 뒤 최종 릴리스 경로로 원자적으로 이동한다. 실패한 업로드의 임시 청크는 관리자 사이트의 정리 요청으로 삭제하며, 최종 릴리스는 Compose의 `rms-releases` 볼륨에 영속화한다.

## Desktop recovery implementation — 2026-09-22 15:00 KST

| 범위 | 확정 동작 |
| --- | --- |
| 분실 복구 | 새 로컬 identity에서 기존 복구 코드/파일 검증 → 새 복구 자료 보관/재확인 → 기존 기기 해지·새 권한 승인. 활성 vault와 이관 중 pending 복구 분리; ACK 유실은 같은 서명으로 재확인 |
| 백업 | 별도 암호화 사본으로 가져오고 재인증·동의 후 새 ID로 데이터 복원. 기존 DB·identity·서명 outbox 덮어쓰기 금지, 같은 사본 적용 멱등 |
| 키 보존 | 과거 키 자동 삭제 없음. 동의한 재암호화 작업은 검증된 sync 이후 최대 100개씩 진행, 충돌/키 변경 시 중지. 과거 사본 회수나 forward secrecy를 보장하지 않음 |
| 이관 예외 | 동일 ID의 만료 source 재확인·과거 계획 보존, 이전 구조/반복/종속 변경은 revision 확인 후 명시적 새 의도로 등록 |
| 출시 경계 | 모바일은 후순위. 운영 키·실제 DB 이관·배포·평문 삭제 미실행. 조정 기기 분실 복구의 독립 MySQL 통합 검증 완료(2026-09-22 15:43 KST); 최종 실사용 및 운영 승인 대기 |
# Desktop logging

일반 실행은 상세 진단 로그를 제공한다. 사용자 요청에 따라 `--secure-logs` 또는 Windows 루트 명령 `pnpm dev:desktop:secure`에서 앱의 main/파일/renderer 로그를 차단한다. 에이전트 앱 실행은 secure 모드를 사용한다. 기존 로그 삭제나 OS/Chromium 진단 차단은 포함하지 않으며, 일반 로그 공유 전 개인정보 확인이 필요하다.
