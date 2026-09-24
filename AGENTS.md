# Agent verification and logs

- 에이전트가 데스크톱 앱을 실행하거나 검증할 때에는 반드시 secure 로그 모드를 사용한다.
- Windows 개발 실행: 프로젝트 루트에서 `pnpm dev:desktop:secure`.
- Electron 또는 설치된 앱 직접 실행: 실행 인자에 `--secure-logs`를 추가한다. Electron smoke 테스트에도 같은 플래그를 사용한다.
- secure 모드에서는 앱 main/파일/renderer 로그가 억제된다. 에이전트는 이 상태에서만 실행 로그를 확인한다. 문제 진단을 위해 임의로 일반 상세 로그 모드로 전환하지 않는다.
- 일반 모드로 이미 생성된 원본 로그, 개인 DB 및 비밀 환경 파일은 사용자 허락 없이 읽지 않는다. 사용자가 직접 제공한 로그와 개인정보가 없는 합성 테스트 픽스처는 요청 범위 내에서 검증할 수 있다.
- secure 플래그는 기존 로그 파일을 redact하거나 삭제하지 않으며, OS/Chromium 자체 진단까지 가린다는 의미는 아니다.

# Task documents

- `docs/tasks.md`에는 TODO/WIP 태스크만 최신 순으로 둔다. DONE이 되면 같은 표 형식의 `docs/tasks_done.md`로 행을 옮기고 상세 기록을 `docs/tasks/done/`으로 이동한다.
- 태스크 번호는 두 목록 전체에서 증가하며 재사용하지 않는다. 이동 후 문서의 상대 링크와 다른 문서에서 해당 태스크를 가리키는 링크를 확인한다.
