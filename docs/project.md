# Thread Project

## 목적

Thread는 데스크톱과 모바일에서 사용할 수 있는 개인 할 일 및 일정 관리 서비스다. 클라이언트의 변경 사항을 트랜잭션과 블록 형태로 기록하고 중앙 애플리케이션 서버를 통해 여러 기기 사이에서 동기화한다.

- 슬로건: `Track. Handle. Remember. Execute. And Deliver.`
- 서비스 도메인: `threadapp.kr`
- 신규 앱 식별자: 데스크톱 `kr.threadapp.desktop`, 모바일 `kr.threadapp.mobile`

## 구성 요소

| 경로 | 역할 | 배포 형태 |
| --- | --- | --- |
| `apps/desktop/` | Electron + React 데스크톱 클라이언트 | 네이티브 패키지 |
| `apps/mobile/` | React Native 모바일 클라이언트 | iOS/Android 앱 |
| `apps/web/site/` | React 공개 웹사이트 | Docker/Nginx 지원 |
| `apps/web/admin/` | React 관리자 대시보드 | Docker/Nginx 지원 |
| `services/api/` | Go/Gin 인증 및 상태 동기화 서버 | Docker 지원 |
| `services/rms/` | Node.js/Express 릴리스 관리 서버 | Docker 지원 |

## 데이터 흐름

1. 데스크톱 또는 모바일 클라이언트에서 할 일, 하위 할 일, 카테고리를 변경한다.
2. 클라이언트는 변경을 트랜잭션으로 만들고 로컬 상태에 반영한다.
3. 인증된 WebSocket 연결을 통해 애플리케이션 서버에 트랜잭션을 제출한다.
4. 서버는 사용자별 상태와 블록을 계산해 MySQL에 저장하고 연결된 클라이언트에 전파한다.
5. 클라이언트는 블록 또는 스냅샷을 받아 로컬 상태를 동기화한다.

## 저장소 정책

관련 구성 요소는 단일 Git 저장소에서 관리한다. 사용자 애플리케이션은 `apps/`, 백엔드 서비스는 `services/` 아래에 배치한다. 과거 독립 저장소의 커밋 이력은 모노레포 이력에 포함하며, 데스크톱과 모바일 앱은 Compose 대상에서 제외한다. Node.js 구성 요소는 프로젝트별 `pnpm-lock.yaml`을 사용해 설치와 lifecycle을 서로 격리한다.

환경 변수의 소유 범위도 실행 경계에 맞춘다. Compose로 실행하는 MySQL, Redis, API, RMS 및 웹 애플리케이션은 저장소 루트의 `.env`를 공유한다. 네이티브 데스크톱과 모바일 클라이언트는 각각 `apps/desktop/`과 `apps/mobile/` 아래의 환경 파일에서 공개 endpoint 및 플랫폼별 클라이언트 설정을 읽으며, 클라이언트 환경 변수에는 서버 비밀값을 저장하지 않는다.
