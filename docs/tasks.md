# Tasks

| Index | Tag | Updated | Status | Completed | Deps | 항목 | 완료 조건 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 8 | desktop | 2026-08-30 03:53 | 🟢 DONE | 2026-08-30 03:53 | #6 | 현재 Thread 로고로 데스크톱 tray 아이콘 갱신 | 현재 `logo512.png`를 원본으로 투명 배경의 16·32·48·512px tray PNG를 생성했다. 이미지 규격·시각 검증, Desktop 빌드·Electron 패키징 및 `extraResources`의 원본 SHA-256 일치 검증을 통과했다. |
| 7 | security | 2026-08-30 03:53 | 🟡 WIP |  | #6 | 노출된 Electron env를 Git 전체 이력에서 제거하고 Desktop env로 이전 | `public/electron/.env`의 모든 과거 경로와 blob이 로컬 전체 refs 및 GitHub `master`에서 제거되고, Apple notarization 값은 Git 제외된 Desktop `.env.local`, RMS endpoint는 Desktop `.env` 및 `.env.production`에서 로드되며 각 키 사용처와 패키징이 검증된다. |
| 6 | repository | 2026-08-30 03:22 | 🟢 DONE | 2026-08-30 03:22 | #4 | 환경 변수 소유 범위를 Compose와 네이티브 앱별로 분리 | Docker Compose 대상은 루트 `.env`를 사용하고, 데스크톱과 모바일은 각 앱 디렉터리의 환경 파일에서 endpoint 및 클라이언트 설정을 읽는다. Compose 구문, 데스크톱 production 빌드·Electron 패키징·ASAR env 포함, 모바일 Android JS 번들과 env 주입 검증을 통과했다. 모바일 전체 TSC/ESLint는 기존 TypeScript 의존성 및 CRLF 오류가 남아 있다. |
| 5 | repository | 2026-08-30 02:46 | 🟡 WIP |  | #4 | 제품을 Memorial에서 Thread로 리브랜딩 | 제품명과 슬로건이 Thread 및 `Track. Handle. Remember. Execute. And Deliver.`로 변경되고, 신규 서버 기준으로 앱 ID·패키지·DB·Docker·배포 경로와 문서가 일관되게 갱신된다. 웹·데스크톱 빌드, Go 테스트(`-vet=off`)와 Electron 패키징은 통과했으며, Docker 엔진 미실행과 잘못된 `JAVA_HOME` 때문에 Compose 런타임 및 Android 빌드는 대기 중이다. 모바일 lint는 기존 CRLF·미사용 코드 오류로 실패한다. |
| 4 | repository | 2026-08-29 23:06 | 🟢 DONE | 2026-08-29 23:06 | #3 | 애플리케이션과 서비스를 역할별 디렉터리로 재구성 | 데스크톱·모바일·웹 클라이언트가 `apps/` 아래에, API·RMS가 `services/` 아래에 배치되고, 루트 스크립트·Compose·Docker 및 문서 경로가 갱신되었다. Compose 구문, Node 설치·빌드, Go 테스트(`-vet=off`), Electron 패키징, Docker 이미지 빌드와 격리된 Compose 런타임 health 및 HTTP 검증을 통과했다. |
| 3 | repository | 2026-08-28 19:24 | 🟢 DONE | 2026-08-28 19:24 | #2 | pnpm 필터 설치와 Electron 패키징 격리 수정 | 데스크톱 필터 설치에서 RMS lifecycle이 실행되지 않고, Windows Electron 패키징이 공용 workspace 의존성을 스캔하지 않은 채 설치 파일을 생성한다. |
| 2 | repository | 2026-08-26 17:45 | 🟢 DONE | 2026-08-26 17:45 | #1 | Node.js 프로젝트를 pnpm workspace로 통합 | 5개 Node.js 프로젝트가 루트 pnpm workspace와 단일 lockfile을 사용하고, Docker 및 문서의 npm/yarn 명령이 pnpm 기준으로 전환되며 설치·빌드·Compose 검증을 통과한다. |
| 1 | repository | 2026-08-25 16:17 | 🟢 DONE | 2026-08-25 16:17 |  | 독립 저장소를 단일 모노레포로 통합하고 Docker Compose 개발 환경 구성 | 제품 저장소의 Git 이력과 기존 미커밋 변경이 보존되고, `memorial_test`는 경로와 이력에서 제거되며, 서버·RMS·관리자 사이트·공개 사이트를 Compose로 구성하고 가능한 범위의 검증을 통과한다. |
