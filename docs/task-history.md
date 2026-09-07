# Task history

정리: 2026-09-07 15:52 (KST)

완료 조건 칸에 누적되었던 실행·검증 기록을 보존한다. 아래 기록은 작성 당시의 결과이며 현재 태스크 상태는 [tasks.md](tasks.md)를 기준으로 한다. 운영 데이터 접근 여부와 미검증 범위도 원문대로 보존했다.

## Task 38

1.1.1 빌드 및 dev 실행 ID 분리 — 기록 기준 2026-09-07 15:39 (KST)

dev 앱 이름·ID·Electron 저장 경로와 단일 실행 잠금을 설치 앱과 분리하고 기존 작업 DB는 보존한다. 회귀 검증 및 Windows 설치 파일 생성 후 실제 dev/설치 앱 동시 실행을 확인한다.

2026-09-07 15:52 추가 검증: renderer 47개 테스트, production 빌드 및 Windows ia32 NSIS 패키징 통과. 임시 프로필의 실제 Electron 프로세스로 prod/dev 동시 잠금 획득 및 각 환경 중복 차단을 확인했다. 설치된 앱이나 실제 사용자 DB는 실행·열람하지 않았다. 앱 ID 분리는 초기화 전 적용하며 기존 프로젝트 내부 작업 DB와 설치 앱 저장 경로를 보존한다.

산출물: `apps/desktop/dist/Thread Setup 1.1.1.exe` (119,322,493 bytes). ASAR 버전 1.1.1·진입점 및 main/appIdentity 원본 일치를 확인했다. SHA-256: `DD3E83EB376C9F3CB506C2E7B99CD32621D02D62F3FACAB7029697DB551C4D0B`. 업로드·설치는 하지 않았다. 기존 dev 프로세스를 완전히 종료한 뒤 재실행하고, 실제 설치 앱과 동시 실행되는지 사용자 확인 대기.

## Task 37

Desktop UI/UX 전면 개선 — 기록 기준 2026-09-07 15:37 (KST)

참고 이미지 기반 charcoal/blue 토큰·상단 검색·사이드바·목록/캘린더 분할·빠른 추가·완료 필터·날짜 상세·설정/팝업을 구현했다. 기존 IPC mutation 계약과 보안 카테고리 필터를 유지했다. 추가 피드백: 상단 42px·시계 22px·메뉴 36px·시계 아래 여백 +10px, 목록/캘린더 12px 단일 단위 남은 시간(상세 유지), 좁은 캘린더 시간 숨김, 삭제 버튼 돌출에 의한 목록 가로 넘침을 수정했다. renderer 41개 테스트·production build(기존 lint 경고) 및 synthetic 실제 브라우저의 기능/치수/900·1280·1600px 내부 넘침 검증 통과. 스크린샷을 디자인 명세에 보존했다. 상단 글자 제거·로고 좌측 12px·검색창 창 중앙 정렬·키 아이콘 80%·설정 글자/아이콘 +2px 추가 반영 및 브라우저/production build 검증 완료. 리스트 기본 및 1100px 기준 자동 분할/단일 뷰 전환, 안내 문구 제거, 메뉴 32px·검색 폭 +30px, 캘린더 시간 남음 제거/opacity 0.4/100px 표시 기준·1px 격자 경계 보강 완료. 추가 검수 반영: 접기 버튼 사이드바 경계로 이동, 우측 정렬 통일, 카테고리 행 26px/제목 여백 6px, 경계 2px 내부 페인팅으로 변경. DPR 1/1.25/1.5 및 1031~1033px 높이에서 경계 픽셀 검사 통과. 최종 후속: 접기 버튼 안쪽 12px·접힌 상태 무아이콘 엣지 핸들(12×88px 클릭 영역), 프로필 66px, 요일/날짜 동일 경계 및 배율별 픽셀 검사 완료. 추가 피드백: 단일 화살표·기본 버튼 padding 제거, 접기/펼치기 top 26px 통일, 핸들 표시 9px/클릭 18px 및 동작 검증. 사용자 시각 검수 대기.

## Task 36

Desktop production env 이력 제거 — 기록 기준 2026-09-07 13:05 (KST)

ignore 예외를 제거하고 별도 복제본 전체 이력에서 해당 경로를 제거했다. master/refactor 양 원격 브랜치를 explicit lease·atomic 강제 푸시하고 로컬 브랜치를 정렬했다. 파일 존재·ignore 적용·추적 해제를 확인했다. 로컬 실제 env·기존 stash/다른 브랜치는 보존했으며 GitHub 캐시/타인의 clone까지 삭제한 것은 아니다.

## Task 35

v2 설정 동기화 상태 및 1.1.0 빌드 — 기록 기준 2026-09-07 02:21 (KST)

설정을 연결 상태·미전송 변경·마지막 반영 번호로 교체하고 현재 상태 조회/실시간 갱신/데이터 보존 재시도 IPC를 연결했다. 계정 필터·초기 응답 경쟁·개별 구독 해제를 검증했다. renderer 29개 및 SQLite/mock service 테스트 1개 통과, production build와 Windows ia32 NSIS 1.1.0 패키징 완료. asar 버전·진입점·최종 renderer·sync/IPC 코드 일치를 확인했다. 기존 lint 경고는 남아 있으며 실제 설치·운영 서버 호출·업로드는 하지 않았다.

## Task 34

상단 평상시 sync 상태 제거 및 설정 0/0 진단 — 기록 기준 2026-09-07 02:10 (KST)

평상시 debug 상태 줄을 제거하고 복구/오류 경고를 보존했다. UI 테스트 6개와 Root/경고 컴포넌트 transpilation, diff 검사를 통과했다. 설정 0/0은 legacy block IPC만 구독하고 v2 status를 구독하지 않는 표시 문제로 확인했다. 설정 변경은 이번 진단 범위에 포함하지 않았다. 실제 Electron 실행/패키징은 수행하지 않았다.

## Task 33

제공된 Thread 로고와 favicon 적용 — 기록 기준 2026-09-07 01:33 (KST)

제공된 PNG로 desktop/site/admin logo192/512·favicon과 desktop 설치/tray 1x/2x/3x 아이콘을 교체했다. PNG 원본 일치·크기·투명도·manifest 참조·ICO 모든 프레임을 검증했다. 관리자 배너를 새 로고/Thread로 변경하고 회귀 테스트 및 production build(기존 lint 경고), build 자산 hash 일치를 확인했다. 실제 설치/OS 아이콘 표시 및 서버 배포는 수행하지 않았다.

## Task 32

제공된 SQL 백업의 격리 DB 리허설 — 기록 기준 2026-09-07 01:25 (KST)

승인된 백업을 network=none/tmpfs MySQL에 복원하고 schema5·전체 check/apply/verify·재실행을 통과했다. 기존 모든 테이블 행과 재실행 전후 전체 DB 행의 SHA-256 일치를 확인했다. 임시 DB는 정리하고 원본 백업은 보존했다. 개인정보 원문 출력·운영 DB 접근은 하지 않았다. 실제 기기·부하 검증은 포함하지 않는다.

## Task 31

v2 일괄 배포 및 운영자 실행 migration 준비 — 기록 기준 2026-09-06 04:25 (KST)

schema5·전체 check/apply/verify CLI·원자적 backfill/검증 기록·신규 빈 계정 v2 준비·구버전 sync/진단 차단을 구현했다. 가짜 MySQL fixture에서 schema4→5, 실패 rollback, 재실행, 기존 원문/ID/날짜/순서와 v2 수정값 보존을 검증했고 Go 전체 tests·두 binary compile·example Compose config를 통과했다. 운영자 실행 절차를 문서화했다. 운영 데이터 접근·이관·배포는 하지 않았으며 실제 실행은 #29에서 사용자 담당이다.

## Task 30

Schema version 기반 자동 migration 실행기 — 기록 기준 2026-09-05 22:09 (KST)

서버 시작 및 local DB 준비 시 version/checksum migration을 실행한다. SQLite 파일·백업·rollback·동시성·DB ready 테스트 7개, Go 단위 테스트·API 컴파일·desktop 빌드를 통과했다. 격리된 실제 MySQL 8에서 기존 row 보존·재실행·동시 실행·downgrade/checksum 차단·부분 DDL 실패 후 applying 상태와 재시도 차단을 검증했다. 운영 DB·사용자 SQLite에는 적용하지 않았다.

## Task 29

운영자 직접 v2 일괄 배포 — 기록 기준 2026-09-07 13:43 (KST)

사용자가 비공개 운영 환경에서 v2 일괄 배포 완료를 확인했다. Codex는 운영 DB·데이터·로그에 접근하거나 실행 결과를 독립 검증하지 않았다. v2 쓰기 이후 단순 rollback 금지.

## Task 28

사본 rehearsal 및 synthetic 부하 검증 — 기록 기준 2026-09-07 13:45 (KST)

제공된 서버 SQL 사본의 복원·이관·원본 보존·재실행 검증을 #32에서 완료했고, 사용자가 #28의 완료를 확인했다. Codex는 운영 DB에 접근하지 않았으며 사용자 SQLite·실제 기기·부하 결과를 독립 검증하지 않았다.

## Task 27

모바일 조회를 v2 sync 프로토콜에 연결 — 기록 기준 2026-09-06 02:15 (KST)

capabilities·snapshot/delta·계정별 atomic cache·삭제/정렬·foreground/poll/WS adapter를 구현했다. 캐시/Redux 테스트 5개와 변경 6파일 transpilation 통과. 전체 tsc는 기존 TS 4.8 / Node 타입 선언 문법 불일치로 실패했다. 실제 Android/iOS 조회·재접속·계정 전환 사용자 검증은 대기한다. 편집/outbox는 추가하지 않았다.

## Task 26

Desktop local DB·outbox·sync v2 이관 — 기록 기준 2026-09-07 13:45 (KST)

별도 SQLite schema·durable outbox·atomic cursor/ACK·IPC/UI·원장 대조와 guarded pending import를 구현하고 원본 backup/복구 기록을 보존했다. 자동·mock 테스트와 production/1.1.0 패키징을 통과했으며 사용자가 실제 환경에서 완료를 확인했다. Codex는 사용자 SQLite·다기기 동작을 독립 검증하지 않았다.

## Task 25

Cursor push/pull·snapshot·WS·retention 구현 — 기록 기준 2026-09-06 02:15 (KST)

schema 4·인증된 HTTP/WS·고정 snapshot/pin·서명 cursor·legacy writer fence/proof를 구현했다. 격리 MySQL에서 immutable snapshot 이후 변경·고정 H·gap/stale cursor·ACK retry·prune/receipt 보존·tenant/epoch/device·fence 대기와 HTTP/WS 전달을 검증했다. API 전체 tests/compile 및 example Compose config 통과. 클라이언트 fixture의 reset/pending 보존도 검증했다. prune/v2는 기본 비활성, 운영 전환은 수행하지 않았다.

## Task 24

Canonical schema와 원자적 mutation engine 구현 — 기록 기준 2026-09-05 23:55 (KST)

schema 3과 독립 v2 Store를 구현했다. 격리 MySQL에서 필드 병합·동시 seq·동일 요청 재시도·tenant/epoch/device 격리·log 실패/부분 생성 rollback·soft delete cascade·정렬/rebalance·회차별 단일 완료를 검증했다. 기존 schema 2→3 upgrade와 API 전체 테스트·컴파일도 통과했다. HTTP/WS·클라이언트·운영 이관은 후속 단계이며 v1 경로와 운영 데이터는 바꾸지 않았다.

## Task 23

Legacy 사본 검증·안전한 이관 기반 마련 — 기록 기준 2026-09-05 22:46 (KST)

읽기 전용 preflight CLI와 결정적인 canonical row 계획을 구현했다. strict JSON·ID/참조/순서·중복 provenance, 19개 legacy type header, 10,000 task 및 재실행·파일 덮어쓰기 방지 시험을 통과했다. 격리 MySQL의 SELECT-only 계정으로 사용자별 같은 block 번호 격리·원본 보존·중복/고아/cross-user 차단과 CLI 실행을 검증했다. 실제 데이터 적용과 local pending 변환은 후속 단계이며 운영 DB는 수정하지 않았다.

## Task 22

Canonical DB·change log 동기화 설계 및 마이그레이션 정책 확정 — 기록 기준 2026-09-05 22:03 (KST)

서버·desktop·mobile 조회 경로, schema·protocol·충돌·retention·데이터 보존·실행 계획을 문서화하고 링크·task index를 검증했다. 사용자가 계정별 opt-in과 전환 계정 구버전 sync 차단·pending import 정책을 승인했다. 모바일은 조회 adapter만 포함한다.

## Task 21

링크 복사 안내 자동 숨김 — 기록 기준 2026-09-05 20:41 (KST)

안내를 3초 후 숨기고 재복사 시 타이머를 재설정하며 언마운트 시 정리한다. 관련 테스트 3개와 관리자 production 빌드를 통과했다(기존 lint 경고). 원격 배포는 수행하지 않았다.

## Task 20

Windows 최신 버전 표시 응답 처리 수정 — 기록 기준 2026-09-05 20:30 (KST)

Windows 상태에 응답의 data를 저장하도록 수정했다. 모의 API 응답을 사용한 실제 컴포넌트 회귀 테스트에서 버전 표시 및 물음표·Invalid date 미표시를 확인했고 관리자 production 빌드를 통과했다(기존 lint 경고). 원격 배포는 수행하지 않았다.

## Task 19

릴리스 도메인 링크 메뉴 및 alert 인증 전달 수정 — 기록 기준 2026-09-05 20:41 (KST)

설정된 RMS 도메인의 다운로드·링크 복사 메뉴를 구현했다. 관리자 테스트 2개와 production 빌드, RMS 인증 전달·인증 실패 시 DB 미갱신 모의 검증을 통과했다. 사용자가 도메인 링크 다운로드·복사와 alert 요청 성공을 확인했다. 복사 안내 자동 숨김은 #21에서 처리한다. API의 alert 처리 자체는 기존 stub이므로 실시간 알림 전달 구현을 의미하지 않는다.

## Task 18

트레이 메뉴에서 현재 로그 파일 위치 열기 — 기록 기준 2026-09-05 20:41 (KST)

트레이 로그 보기 메뉴에서 현재 실행의 로그 경로로 shell.showItemInFolder를 호출하도록 구현했다. 개발·배포 경로 전달과 초기화 전 방어 동작을 모의 검증하고 구문 검사를 통과했다. 사용자가 실제 로그 보기 동작 성공을 확인했다.

## Task 17

Google 가입 충돌 및 잘못된 로그인 토큰 수정 — 기록 기준 2026-09-05 20:41 (KST)

409 이후 인증 저장을 차단하고 API가 Google 토큰 대신 서버 사용자 조회 후 Thread JWT를 발급하도록 수정했다. 데스크톱은 서버 UID를 기준으로 로컬 계정을 연결하며 미등록 사용자는 가입 후 Google 재로그인을 안내한다. 데스크톱 테스트 17개, API 컨트롤러 테스트, production 빌드와 구문 검사 통과(기존 lint 경고). 로그인·가입 화면의 메모리얼 문구를 Thread로 변경했다. 사용자가 실제 Google 로그인 성공을 확인했다. 신규 가입 및 409 충돌 후 복구 경로의 사용자 검증은 아직 확인되지 않아 WIP를 유지한다.

## Task 16

Cloudflare 제한을 우회하는 릴리스 청크 업로드 구현 — 기록 기준 2026-09-05 03:39 (KST)

관리자 웹의 8MiB 순차 전송과 RMS의 메타데이터 검증·임시 저장·순서 결합·크기 검증·실패 정리를 구현했다. 실제 119MB 설치 파일 15청크 SHA-256 일치, 관리자 빌드, Compose 설정, RMS·관리자 Docker 빌드와 격리된 HTTP/MySQL 통합 검증에서 파일 저장 및 `win=1` 갱신을 확인했다.

## Task 15

프로젝트 라이선스를 MIT로 명시 — 기록 기준 2026-09-04 22:18 (KST)

저작권자를 shyunku로 명시한 표준 MIT LICENSE를 루트에 추가하고 루트 및 RMS 패키지 라이선스 표기를 MIT로 통일했다. JSON 파싱과 라이선스 원문을 검증했다.

## Task 14

업데이트 확인 실패 시 경고 후 앱 실행 및 1.0.3-beta 배포 준비 — 기록 기준 2026-09-04 22:17 (KST)

`react-cssfx-loading`의 CircularProgress를 적용하고 요청을 10초로 제한했다. 실패 시 종료 대신 앱 내부 경고 모달의 계속 응답을 기다리도록 변경했으며 production 빌드와 Electron 패키징을 통과하고 1.0.3-beta 설치 파일 내 반영을 확인했다.

## Task 13

인증 토큰 원문 로그 제거 — 기록 기준 2026-09-04 12:39 (KST)

access token과 refresh token 로그를 redacted 값으로 대체했다. 원문 토큰 로그 정적 검사 0건, API 전체 테스트 및 `app-server` Docker 이미지 빌드를 통과했다.

## Task 12

Cloudflare Tunnel 기반 local/production Compose 설정 분리 — 기록 기준 2026-09-04 12:39 (KST)

관리자 웹 build args의 local/production 분기, `USE_HTTPS`, 네 서비스의 loopback 바인딩을 반영했다. Compose config, API 전체 테스트, 관리자 production 빌드와 `app-server`·`admin-site` Docker 이미지 빌드를 통과했으며 실제 `.env`와 `.env.production`은 수정하지 않았다.

## Task 11

데스크톱 앱 버전을 1.0.2로 상향 — 기록 기준 2026-08-30 05:30 (KST)

`apps/desktop/package.json` 버전을 1.0.2로 변경했고 데스크톱 production 빌드를 통과했다. 기존 ESLint 경고는 남아 있으나 빌드 오류는 없다.

## Task 10

관리자 인증을 DB 계정에서 env 고정 계정으로 전환 — 기록 기준 2026-08-30 05:20 (KST)

루트 `.env`의 실제 관리자 값을 Compose API에 적용했다. `app-server` 재빌드·재생성 후 실제 env 자격 증명 로그인 성공, 오답 401, 관리자 API 200, refresh 성공 및 전체 서비스 상태를 확인했다.

## Task 9

관리자 로그인 버튼의 React 이벤트 직렬화 오류 수정 — 기록 기준 2026-08-30 04:48 (KST)

로그인 핸들러가 component state만 사용하도록 수정했다. React production 빌드와 Compose 재배포를 완료했고, 새 번들 HTTP 200, 전체 서비스 실행·health, 구조화된 무효 로그인 요청의 API 401 응답을 확인했다.

## Task 8

현재 Thread 로고로 데스크톱 tray 아이콘 갱신 — 기록 기준 2026-08-30 03:53 (KST)

현재 `logo512.png`를 원본으로 투명 배경의 16·32·48·512px tray PNG를 생성했다. 이미지 규격·시각 검증, Desktop 빌드·Electron 패키징 및 `extraResources`의 원본 SHA-256 일치 검증을 통과했다.

## Task 7

노출된 Electron env를 Git 전체 이력에서 제거하고 Desktop env로 이전 — 기록 기준 2026-08-30 04:08 (KST)

`public/electron/.env`의 모든 과거 경로와 blob이 로컬 전체 refs 및 GitHub `master`에서 제거되고, Apple notarization 값은 Git 제외된 Desktop `.env.local`, RMS endpoint는 Desktop `.env` 및 `.env.production`에서 로드되며 각 키 사용처와 패키징이 검증된다.

## Task 6

환경 변수 소유 범위를 Compose와 네이티브 앱별로 분리 — 기록 기준 2026-08-30 03:22 (KST)

Docker Compose 대상은 루트 `.env`를 사용하고, 데스크톱과 모바일은 각 앱 디렉터리의 환경 파일에서 endpoint 및 클라이언트 설정을 읽는다. Compose 구문, 데스크톱 production 빌드·Electron 패키징·ASAR env 포함, 모바일 Android JS 번들과 env 주입 검증을 통과했다. 모바일 전체 TSC/ESLint는 기존 TypeScript 의존성 및 CRLF 오류가 남아 있다.

## Task 5

제품을 Memorial에서 Thread로 리브랜딩 — 기록 기준 2026-08-30 02:46 (KST)

제품명과 슬로건이 Thread 및 `Track. Handle. Remember. Execute. And Deliver.`로 변경되고, 신규 서버 기준으로 앱 ID·패키지·DB·Docker·배포 경로와 문서가 일관되게 갱신된다. 웹·데스크톱 빌드, Go 테스트(`-vet=off`)와 Electron 패키징은 통과했으며, Docker 엔진 미실행과 잘못된 `JAVA_HOME` 때문에 Compose 런타임 및 Android 빌드는 대기 중이다. 모바일 lint는 기존 CRLF·미사용 코드 오류로 실패한다.

## Task 4

애플리케이션과 서비스를 역할별 디렉터리로 재구성 — 기록 기준 2026-08-29 23:06 (KST)

데스크톱·모바일·웹 클라이언트가 `apps/` 아래에, API·RMS가 `services/` 아래에 배치되고, 루트 스크립트·Compose·Docker 및 문서 경로가 갱신되었다. Compose 구문, Node 설치·빌드, Go 테스트(`-vet=off`), Electron 패키징, Docker 이미지 빌드와 격리된 Compose 런타임 health 및 HTTP 검증을 통과했다.

## Task 3

pnpm 필터 설치와 Electron 패키징 격리 수정 — 기록 기준 2026-08-28 19:24 (KST)

데스크톱 필터 설치에서 RMS lifecycle이 실행되지 않고, Windows Electron 패키징이 공용 workspace 의존성을 스캔하지 않은 채 설치 파일을 생성한다.

## Task 2

Node.js 프로젝트를 pnpm workspace로 통합 — 기록 기준 2026-08-26 17:45 (KST)

5개 Node.js 프로젝트가 루트 pnpm workspace와 단일 lockfile을 사용하고, Docker 및 문서의 npm/yarn 명령이 pnpm 기준으로 전환되며 설치·빌드·Compose 검증을 통과한다.

## Task 1

독립 저장소를 단일 모노레포로 통합하고 Docker Compose 개발 환경 구성 — 기록 기준 2026-08-25 16:17 (KST)

제품 저장소의 Git 이력과 기존 미커밋 변경이 보존되고, `memorial_test`는 경로와 이력에서 제거되며, 서버·RMS·관리자 사이트·공개 사이트를 Compose로 구성하고 가능한 범위의 검증을 통과한다.
