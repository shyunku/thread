# Tasks

| Index | Tag | Updated | Status | Completed | Deps | 항목 | 완료 조건 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 3 | repository | 2026-08-28 19:24 | 🟢 DONE | 2026-08-28 19:24 | #2 | pnpm 필터 설치와 Electron 패키징 격리 수정 | 데스크톱 필터 설치에서 RMS lifecycle이 실행되지 않고, Windows Electron 패키징이 공용 workspace 의존성을 스캔하지 않은 채 설치 파일을 생성한다. |
| 2 | repository | 2026-08-26 17:45 | 🟢 DONE | 2026-08-26 17:45 | #1 | Node.js 프로젝트를 pnpm workspace로 통합 | 5개 Node.js 프로젝트가 루트 pnpm workspace와 단일 lockfile을 사용하고, Docker 및 문서의 npm/yarn 명령이 pnpm 기준으로 전환되며 설치·빌드·Compose 검증을 통과한다. |
| 1 | repository | 2026-08-25 16:17 | 🟢 DONE | 2026-08-25 16:17 |  | 독립 저장소를 단일 모노레포로 통합하고 Docker Compose 개발 환경 구성 | 제품 저장소의 Git 이력과 기존 미커밋 변경이 보존되고, `memorial_test`는 경로와 이력에서 제거되며, 서버·RMS·관리자 사이트·공개 사이트를 Compose로 구성하고 가능한 범위의 검증을 통과한다. |
