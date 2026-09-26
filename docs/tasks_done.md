# Completed Tasks

완료된 태스크는 최신 항목이 위에 오도록 보관한다. 새 태스크 번호는 [진행 중인 태스크](tasks.md)와 이 문서 전체에서 가장 큰 번호 다음으로 발급한다.

| Index | Tag | Updated | Status | Completed | Deps | 항목 | 완료 조건 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 56 | privacy/ux | 2026-09-26 15:42 | 🟢 DONE | 2026-09-26 15:42 | #50, #54, #55 | 보호 상태·로그·개인정보 안내 ([기록](tasks/done/0056.md)) | 보호 상태·평문 잔존·복구 안내 및 합성 누출 검사 완료. 별도 화면 디자인 검증은 #59/#60. |
| 54 | migration | 2026-09-26 15:39 | 🟢 DONE | 2026-09-26 15:39 | #50, #52 | v2→v3 이관·중단 복구 ([기록](tasks/done/0054.md)) | 사용자 이관·재실행 유지와 계정/vault ACTIVE·암호문 레코드 검증 완료. 운영 이관은 #64, 모바일은 #53. |
| 61 | api/storage | 2026-09-22 21:09 | 🟢 DONE | 2026-09-22 21:09 | #51, #54 | v3 signed batch 중복 저장 제거 ([기록](tasks/done/0061.md)) | 공유 저장·검증형 schema12 정리·10만 fixture 및 전체 회귀 통과. |
| 58 | rms/infra | 2026-09-10 20:16 | 🟢 DONE | 2026-09-08 13:08 |  | RMS Bullseye 저장소 만료 빌드 복구 ([기록](tasks/done/0058.md)) | 지원 베이스 이미지에서 빌드·네이티브 모듈·RMS 회귀 검증. |
| 51 | api/sync | 2026-09-24 03:51 | 🟢 DONE | 2026-09-09 13:38 | #49 | 암호문 push/pull·snapshot ([기록](tasks/done/0051.md)) | 원본 서명 provenance·CAS·멱등성·snapshot 무결성 검증. |
| 49 | api/vault | 2026-09-10 20:16 | 🟢 DONE | 2026-09-09 13:38 | #47 | Vault·멤버십·기기 권한 API ([기록](tasks/done/0049.md)) | 추가 schema migration 및 승인·해지·복구 권한 검증. |
| 48 | desktop/storage | 2026-09-24 16:39 | 🟢 DONE | 2026-09-24 16:39 | #45, #47 | 암호화 로컬 DB·키 보관·잠금 ([기록](tasks/done/0048.md)) | Windows 잠금·복구 사용자 확인, Node/React·합성 Electron 화면 검증. 5분 유휴 잠금 제거; v2 이관·설치 업그레이드는 #54/#64. |
| 47 | crypto/protocol | 2026-09-24 03:17 | 🟢 DONE | 2026-09-24 03:17 | #43 | 암호 포맷·키 계층·교차 플랫폼 벡터 ([기록](tasks/done/0047.md)) | 인코딩·서명·변조 거부와 Desktop/Mobile 공통 벡터 자동 검증 완료. 실기기·독립 리뷰는 #53/#63/#57. |
| 46 | rms/security | 2026-09-24 03:51 | 🟢 DONE | 2026-09-24 03:13 | #43 | 서명된 업데이트와 배포 신뢰 ([기록](tasks/done/0046.md)) | TUF 검증·서명 생성 도구·updater 연결과 합성 키 회귀 통과. 운영 배포는 #64, macOS 사전 검증은 #63. |
| 45 | desktop/security | 2026-09-24 04:03 | 🟢 DONE | 2026-09-24 03:09 | #44 | 지원 Electron·OS 키 저장소 검증 ([기록](tasks/done/0045.md)) | Windows 빌드·키 보호·실기기 재인증 확인. 실사용 설치 덮어쓰기는 #64, macOS는 #63. |
| 44 | desktop/security | 2026-09-24 04:03 | 🟢 DONE | 2026-09-08 14:02 | #43 | Electron 렌더러·IPC 권한 격리 ([기록](tasks/done/0044.md)) | Node/remote/env 노출 제거, sender·채널 경계 테스트 및 사용자 앱 회귀 확인. |
| 43 | security/plan | 2026-09-24 03:51 | 🟢 DONE | 2026-09-08 12:50 | #41 | E2EE 구현 순서·검증 게이트 확정 ([기록](tasks/done/0043.md)) | 패치 전 범위를 태스크·의존성·사용자 확인 지점으로 매핑. |
| 42 | infra | 2026-09-08 12:26 | 🟢 DONE | 2026-09-08 12:26 |  | MySQL SSH 터널용 루프백 포트 게시 ([기록](tasks/done/0042.md)) | 127.0.0.1:3309→3306 매핑과 Compose 구성 검증. |
| 41 | security/design | 2026-09-08 12:09 | 🟢 DONE | 2026-09-07 23:27 | #39, #40 | E2EE 및 개인정보 보호 설계 ([기록](tasks/done/0041.md)) | 위협 모델·키 복구·동기화·이관·UX·검증 기준을 설계 문서로 정리. |
| 40 | desktop/release | 2026-09-07 18:34 | 🟢 DONE | 2026-09-07 18:34 | #38, #39 | 패키징된 앱의 시작 오류 수정 및 1.1.3 릴리스 ([기록](tasks/done/0040.md)) | appId 누락 패키지의 정상 시작을 검증하고 1.1.3 Windows 설치 파일 생성. |
| 39 | rms/api/desktop | 2026-09-07 18:05 | 🟢 DONE | 2026-09-07 18:05 | #19 | 릴리스 alert 발행·수신 구현 ([기록](tasks/done/0039.md)) | 검증된 릴리스의 실시간 알림·누락 복구·필수 업데이트 자동 다운로드와 호환성 플래그 검증. |
| 38 | desktop/release | 2026-09-07 16:03 | 🟢 DONE | 2026-09-07 16:03 |  | 1.1.1 빌드 및 dev 실행 ID 분리 ([기록](tasks/done/0038.md)) | dev/설치 앱 ID·잠금 분리, 데이터 보존, 1.1.1 설치 파일 생성 및 동시 실행 확인. |
| 37 | desktop/design | 2026-09-24 03:18 | 🟢 DONE | 2026-09-24 03:18 |  | Desktop UI/UX 전면 개선 ([기록](tasks/done/0037.md)) | 기존 기능 유지·반응형/화면 검증 및 사용자 일단락 확인. 후속 v3·설정 UI는 #59/#60. |
| 36 | security | 2026-09-07 13:05 | 🟢 DONE | 2026-09-07 13:05 |  | Desktop production env 이력 제거 ([기록](tasks/done/0036.md)) | production env 추적·이력 제거, 로컬 비밀 파일 보존 및 원격 반영 확인. |
| 35 | desktop | 2026-09-07 02:21 | 🟢 DONE | 2026-09-07 02:21 | #34 | v2 설정 동기화 상태 및 1.1.0 빌드 ([기록](tasks/done/0035.md)) | v2 동기화 상태 표시·갱신 검증과 1.1.0 Windows 설치 파일 생성. |
| 34 | desktop | 2026-09-07 02:10 | 🟢 DONE | 2026-09-07 02:10 |  | 상단 평상시 sync 상태 제거 및 설정 0/0 진단 ([기록](tasks/done/0034.md)) | 평상시 sync 상태 줄 제거, 오류 경고 보존 및 설정 0/0 원인 확인. |
| 33 | branding | 2026-09-07 01:33 | 🟢 DONE | 2026-09-07 01:33 |  | 제공된 Thread 로고와 favicon 적용 ([기록](tasks/done/0033.md)) | 새 로고·favicon·tray 적용, 자산 규격·참조 및 빌드 검증. |
| 32 | sync/migration | 2026-09-07 01:25 | 🟢 DONE | 2026-09-07 01:25 | #31 | 제공된 SQL 백업의 격리 DB 리허설 ([기록](tasks/done/0032.md)) | 격리 DB에서 백업 복원·이관·재실행 및 원본 보존 검증. |
| 31 | sync/deployment | 2026-09-06 04:25 | 🟢 DONE | 2026-09-06 04:25 | #25 | v2 일괄 배포 및 운영자 실행 migration 준비 ([기록](tasks/done/0031.md)) | v2 일괄 전환 CLI·신규 계정 준비·구버전 차단 및 운영자 실행 절차 검증. |
| 30 | api/desktop | 2026-09-05 22:09 | 🟢 DONE | 2026-09-05 22:09 | #22 | Schema version 기반 자동 migration 실행기 ([기록](tasks/done/0030.md)) | 스키마 버전 기반 자동 이관, 백업·실패 복구·재실행·동시성 검증. |
| 29 | deployment/sync | 2026-09-07 13:43 | 🟢 DONE | 2026-09-07 13:43 | #28, #31 | 운영자 직접 v2 일괄 배포 ([기록](tasks/done/0029.md)) | 운영자가 v2 일괄 배포 완료 확인. |
| 28 | sync/migration | 2026-09-07 13:45 | 🟢 DONE | 2026-09-07 13:45 | #26, #27 | 사본 rehearsal 및 synthetic 부하 검증 ([기록](tasks/done/0028.md)) | 사본 이관·원본 보존·재실행 및 부하 검증 결과에 대한 사용자 완료 확인. |
| 27 | mobile | 2026-09-24 03:18 | 🟢 DONE | 2026-09-24 03:18 | #25 | 모바일 조회를 v2 sync 프로토콜에 연결 ([기록](tasks/done/0027.md)) | v2 조회 adapter·캐시 및 제한된 자동 회귀 완료. 실기기·전체 빌드 검증은 후순위 #53. |
| 26 | desktop | 2026-09-07 13:45 | 🟢 DONE | 2026-09-07 13:45 | #23, #25 | Desktop local DB·outbox·sync v2 이관 ([기록](tasks/done/0026.md)) | Desktop v2 DB·outbox 이관, 원본 보존 및 사용자 실행 확인. |
| 25 | api/sync | 2026-09-06 02:15 | 🟢 DONE | 2026-09-06 02:15 | #24 | Cursor push/pull·snapshot·WS·retention 구현 ([기록](tasks/done/0025.md)) | Cursor push/pull·snapshot·WS·retention 구현과 격리·재시도 검증. |
| 24 | api/sync | 2026-09-05 23:55 | 🟢 DONE | 2026-09-05 23:55 | #23 | Canonical schema와 원자적 mutation engine 구현 ([기록](tasks/done/0024.md)) | Canonical schema·원자적 mutation 및 충돌·순서·rollback 검증. |
| 23 | sync/migration | 2026-09-05 22:46 | 🟢 DONE | 2026-09-05 22:46 | #22 | Legacy 사본 검증·안전한 이관 기반 마련 ([기록](tasks/done/0023.md)) | 읽기 전용 preflight·결정적 이관 계획·참조 검증과 원본 보존 확인. |
| 22 | sync | 2026-09-05 22:03 | 🟢 DONE | 2026-09-05 22:03 |  | Canonical DB·change log 동기화 설계 및 마이그레이션 정책 확정 ([기록](tasks/done/0022.md)) | Canonical 동기화·충돌·retention·마이그레이션 정책 및 실행 계획 확정. |
| 21 | admin | 2026-09-05 20:41 | 🟢 DONE | 2026-09-05 20:41 |  | 링크 복사 안내 자동 숨김 ([기록](tasks/done/0021.md)) | 복사 안내 3초 후 숨김, 재복사 타이머 갱신·정리 및 빌드 검증. |
| 20 | admin | 2026-09-05 20:30 | 🟢 DONE | 2026-09-05 20:30 |  | Windows 최신 버전 표시 응답 처리 수정 ([기록](tasks/done/0020.md)) | Windows 최신 버전 응답 표시 정상화 및 회귀·빌드 검증. |
| 19 | admin/rms | 2026-09-05 20:41 | 🟢 DONE | 2026-09-05 20:41 |  | 릴리스 도메인 링크 메뉴 및 alert 인증 전달 수정 ([기록](tasks/done/0019.md)) | 도메인 다운로드·링크 복사와 alert 인증 전달 검증(실시간 알림 구현 제외). |
| 18 | desktop | 2026-09-05 20:41 | 🟢 DONE | 2026-09-05 20:41 |  | 트레이 메뉴에서 현재 로그 파일 위치 열기 ([기록](tasks/done/0018.md)) | 트레이 로그 보기로 현재 로그 파일 선택 및 사용자 동작 확인. |
| 17 | desktop/api | 2026-09-07 16:03 | 🟢 DONE | 2026-09-07 16:03 |  | Google 가입 충돌 및 잘못된 로그인 토큰 수정 ([기록](tasks/done/0017.md)) | Google 로그인·신규 가입·409 복구 검증. |
| 16 | admin/rms | 2026-09-05 03:39 | 🟢 DONE | 2026-09-05 03:39 |  | Cloudflare 제한을 우회하는 릴리스 청크 업로드 구현 ([기록](tasks/done/0016.md)) | 청크 업로드·결합·실패 정리 및 실제 파일 무결성·버전 갱신 검증. |
| 15 | repository | 2026-09-04 22:18 | 🟢 DONE | 2026-09-04 22:18 |  | 프로젝트 라이선스를 MIT로 명시 ([기록](tasks/done/0015.md)) | shyunku 저작권의 MIT LICENSE 추가 및 패키지 라이선스 통일. |
| 14 | desktop | 2026-09-04 22:17 | 🟢 DONE | 2026-09-04 22:17 |  | 업데이트 확인 실패 시 경고 후 앱 실행 및 1.0.3-beta 배포 준비 ([기록](tasks/done/0014.md)) | 업데이트 확인 10초 제한·실패 후 계속 실행·CircularProgress 및 1.0.3-beta 패키징 검증. |
| 13 | security | 2026-09-04 12:39 | 🟢 DONE | 2026-09-04 12:39 |  | 인증 토큰 원문 로그 제거 ([기록](tasks/done/0013.md)) | 인증 토큰 원문 로그 제거, 정적 검사·API 테스트·이미지 빌드 검증. |
| 12 | deployment | 2026-09-04 12:39 | 🟢 DONE | 2026-09-04 12:39 |  | Cloudflare Tunnel 기반 local/production Compose 설정 분리 ([기록](tasks/done/0012.md)) | 루트 환경별 build args·USE_HTTPS·loopback 포트 및 Compose/빌드 검증. |
| 11 | desktop | 2026-08-30 05:30 | 🟢 DONE | 2026-08-30 05:30 |  | 데스크톱 앱 버전을 1.0.2로 상향 ([기록](tasks/done/0011.md)) | 데스크톱 버전 1.0.2 변경 및 production 빌드 통과. |
| 10 | api | 2026-08-30 05:20 | 🟢 DONE | 2026-08-30 05:20 | #9 | 관리자 인증을 DB 계정에서 env 고정 계정으로 전환 ([기록](tasks/done/0010.md)) | env 관리자 인증 전환 및 로그인·오답·관리자 API·refresh 검증. |
| 9 | admin | 2026-08-30 04:48 | 🟢 DONE | 2026-08-30 04:48 |  | 관리자 로그인 버튼의 React 이벤트 직렬화 오류 수정 ([기록](tasks/done/0009.md)) | 로그인 요청의 이벤트 직렬화 제거 및 관리자 빌드·배포 검증. |
| 8 | desktop | 2026-08-30 03:53 | 🟢 DONE | 2026-08-30 03:53 | #6 | 현재 Thread 로고로 데스크톱 tray 아이콘 갱신 ([기록](tasks/done/0008.md)) | 현재 로고 기반 tray 이미지 생성 및 규격·패키징 자산 검증. |
| 7 | security | 2026-08-30 04:08 | 🟢 DONE | 2026-08-30 04:08 | #6 | 노출된 Electron env를 Git 전체 이력에서 제거하고 Desktop env로 이전 ([기록](tasks/done/0007.md)) | 노출 env의 Git 이력 제거, 앱별 비밀 설정 이전 및 참조·패키징 검증. |
| 6 | repository | 2026-08-30 03:22 | 🟢 DONE | 2026-08-30 03:22 | #4 | 환경 변수 소유 범위를 Compose와 네이티브 앱별로 분리 ([기록](tasks/done/0006.md)) | Compose는 루트, desktop/mobile은 자체 env 사용 및 설정 주입 검증. |
| 5 | repository | 2026-09-23 16:18 | 🟢 DONE | 2026-09-23 16:18 | #4 | 제품을 Memorial에서 Thread로 리브랜딩 ([기록](tasks/done/0005.md)) | Thread 이름·슬로건·ID·경로 및 앱/서버 빌드 검증. |
| 4 | repository | 2026-08-29 23:06 | 🟢 DONE | 2026-08-29 23:06 | #3 | 애플리케이션과 서비스를 역할별 디렉터리로 재구성 ([기록](tasks/done/0004.md)) | apps/services 구조 전환 및 실행·빌드·Compose 경로 검증. |
| 3 | repository | 2026-08-28 19:24 | 🟢 DONE | 2026-08-28 19:24 | #2 | pnpm 필터 설치와 Electron 패키징 격리 수정 ([기록](tasks/done/0003.md)) | 데스크톱 설치·패키징에서 RMS lifecycle과 공용 의존성 스캔 제외. |
| 2 | repository | 2026-08-26 17:45 | 🟢 DONE | 2026-08-26 17:45 | #1 | Node.js 프로젝트를 pnpm workspace로 통합 ([기록](tasks/done/0002.md)) | Node 프로젝트 pnpm 전환 및 설치·빌드·Compose 검증. |
| 1 | repository | 2026-08-25 16:17 | 🟢 DONE | 2026-08-25 16:17 |  | 독립 저장소를 단일 모노레포로 통합하고 Docker Compose 개발 환경 구성 ([기록](tasks/done/0001.md)) | Git 이력 보존 모노레포 통합, memorial_test 제거 및 Compose 구성·검증. |
