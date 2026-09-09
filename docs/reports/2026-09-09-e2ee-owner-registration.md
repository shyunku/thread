# Owner registration integration

검증: 2026-09-09 22:42 (KST).

복구 파일/코드 검증 후 개발 보관함 화면에서 대상 서버 확인 체크 → 서버 등록·연결 확인을 제공한다. 자동 등록은 하지 않는다. 서버는 E2EE_API_ENABLED가 켜져 있어야 하며, 미지원/로그인 만료는 일반 실패로 표시한다. token은 로그인 계정의 main-process DB에서 읽으며 renderer로 전달하거나 SQL logger에 인자로 기록하지 않는다.

등록 흐름:

1. 로컬 RECOVERY_CONFIRMED와 현재 잠금 해제된 계정을 확인한다.
2. 서버 membership을 조회한다. 명시적 VAULT_NOT_FOUND/404만 신규 pending genesis 등록을 허용한다. 일반 404/500/네트워크 오류를 신규 계정으로 판단하지 않는다.
3. 이미 다른 genesis가 있으면 PAIRING_REQUIRED를 반환하고 로컬/서버 키를 교체하지 않는다.
4. 같은 genesis부터 전체 서명 체인을 검증하고 현재 기기가 남아 있는지 확인한 뒤 REGISTERED를 저장한다.
5. 응답 유실 후 같은 genesis로 재조회한다. 이전에 확인한 서버가 사라졌거나 이력이 과거로 돌아가면 자동 재생성/rollback을 거부한다.
6. 잠금/계정 변경은 AbortController와 저장소 재검사로 중단한다.

검증: 최종 관련 Node 17개 및 UI 5개 통과. 새 화면 lint와 renderer production build 통과(기존 경고 유지). 서버 응답은 synthetic transport로 검증했으며 이번 작업에서 실제 로컬/운영 API에 계정 등록을 실행하지 않았다. 이전 API 테스트와 실제 앱 통합 실행을 구분한다.

등록은 공개 키/서명된 genesis만 저장하는 pending 작업이다. 기존 할 일 업로드·freeze·E2EE 활성화·평문 삭제는 호출하지 않는다. QR/파일 기반 다른 기기 연결, 초기 keyring의 실제 sync epoch 결합, 전체 앱 동기화는 남아 있다. #50 WIP 유지, 실제 운영 데이터 이관은 #57이다.
