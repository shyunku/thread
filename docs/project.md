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

## 관리자 인증

관리자 대시보드는 `user_master` 또는 `admin_master`의 계정 행이 아니라 API 서버의 `ADMIN_ID`와 `ADMIN_PASSWORD` 환경 변수로 관리하는 단일 운영 계정을 사용한다. 관리자 웹은 비밀번호 원문을 전송하지 않고 기존 3단 SHA-256 파생값을 전송하며, API는 환경 변수로 같은 값을 계산해 고정 시간 비교한다. 발급된 JWT에는 서명된 관리자 권한 claim을 포함하고 refresh token은 Redis에서 관리한다.

실제 관리자 ID와 비밀번호는 저장소에 커밋하지 않고 Compose 실행 시 루트 `.env` 또는 배포 환경의 비밀 변수로 제공한다.

## 저장소 정책

관련 구성 요소는 단일 Git 저장소에서 관리한다. 사용자 애플리케이션은 `apps/`, 백엔드 서비스는 `services/` 아래에 배치한다. 과거 독립 저장소의 커밋 이력은 모노레포 이력에 포함하며, 데스크톱과 모바일 앱은 Compose 대상에서 제외한다. Node.js 구성 요소는 프로젝트별 `pnpm-lock.yaml`을 사용해 설치와 lifecycle을 서로 격리한다.

환경 변수의 소유 범위도 실행 경계에 맞춘다. Compose로 실행하는 MySQL, Redis, API, RMS 및 웹 애플리케이션은 저장소 루트의 `.env`를 공유한다. 네이티브 데스크톱과 모바일 클라이언트는 각각 `apps/desktop/`과 `apps/mobile/` 아래의 환경 파일에서 공개 endpoint 및 플랫폼별 클라이언트 설정을 읽으며, 클라이언트 환경 변수에는 서버 비밀값을 저장하지 않는다.

## 배포 구조

공개 사이트와 관리자 사이트는 API 및 RMS와 함께 Docker Compose에 유지한다. 관리자 React 빌드의 공개 endpoint는 루트 env의 `ADMIN_APP_SERVER_ENTRY`와 `ADMIN_RMS_ENTRY`를 Compose build args로 전달해 local 및 production 값을 분리한다. 이 값은 정적 브라우저 번들에 포함되는 공개 설정이며 비밀값을 저장하지 않는다.

운영 환경에서는 EC2 호스트에서 실행하는 Cloudflare Tunnel이 `127.0.0.1`에만 게시된 site, admin-site, API 및 RMS 포트로 연결한다. 외부 TLS는 Cloudflare가 종료하고 private origin은 HTTP를 사용하므로 `USE_HTTPS=false`를 사용한다. `USE_HTTPS=true`는 Go API가 인증서 파일을 직접 읽고 TLS를 종료하는 배포에서만 사용한다. 실제 `.env`와 `.env.production`은 저장소에 커밋하지 않는다.

관리자 사이트의 릴리스 업로드는 Cloudflare의 단일 요청 크기 제한을 넘지 않도록 파일을 8MiB 청크로 순차 전송한다. RMS는 업로드별 메타데이터와 청크를 임시 저장하고 전체 청크의 존재 및 결합 파일 크기를 검증한 뒤 최종 릴리스 경로로 원자적으로 이동한다. 실패한 업로드의 임시 청크는 관리자 사이트의 정리 요청으로 삭제하며, 최종 릴리스는 Compose의 `rms-releases` 볼륨에 영속화한다.
