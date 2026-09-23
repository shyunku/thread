# v3 출시 전 내부 검토와 합성 복원 리허설

검증: 2026-09-23 16:22 (KST) · #47, #57

| 범위 | 확인 결과 |
| --- | --- |
| 서명·인코딩 | API와 Desktop이 같은 `thread-e2ee-v1` 도메인, purpose+body Ed25519 범위, 정규 CBOR 및 최대 1 MiB 한도를 사용한다. 필드 AAD는 키를 가진 Desktop에서 검사한다. Go 프로토콜 테스트 통과 |
| 기기 연결 | 요청의 공개키·nonce·10분 만료·fingerprint 확인, 기존 기기 재인증, 승인 기기의 write/authorize 권한, 수신자 키로 봉인된 응답을 코드에서 확인. pairing 파일·QR·변조/만료/오수신자 테스트 3개 통과 |
| 업데이트 | root 역할과 배포 역할을 분리하고 catalog·파일의 서명·digest 및 rollback을 확인하는 테스트 3개 통과. 내장 운영 root와 실제 서명 설치본은 아직 없음 |
| 서버 저장 | schema11→12의 공유 signed record, 1천/1만/10만 객체 용량·MySQL lifecycle·이관 취소 검증은 [#61 측정](2026-09-22-v3-record-storage.md)에 기록 |
| 평문 inventory | 새 읽기 전용 도구가 계정별 v1 blocks/transactions, v2 task·category·subtask·change log·receipt·snapshot·이관 source page의 행 수와 payload 길이만 조회. 합성 계정 2개의 범위 격리·원문 비출력 확인 |
| 백업 복원 | 별도 tmpfs MySQL 8에서 v2 평문·v3 공유 암호문·객체·스냅샷을 합성 생성. single-transaction/hex-blob 백업을 새 DB에 복원하고 전체 테이블 데이터 덤프 SHA-256 일치, 공유 record digest·객체/스냅샷 참조 및 inventory 상태 확인 |
| Compose | 비밀값 없는 `.env.example`로 config 검증, API·RMS·site·admin-site 4개 이미지 빌드 통과 |

## 운영자가 사용할 읽기 전용 inventory

`services/api`에서 필요한 테이블 전부에 SELECT 권한만 가진 MySQL DSN을 `THREAD_V3_INVENTORY_DSN` 환경 변수로 제공하고 `go run ./cmd/v3-legacy-inventory --user <exact-uid>`를 실행한다. 도구는 `.env` 파일을 열지 않고, 데이터 원문이나 UID를 출력하지 않는다. 계정 모드·vault 모드·테이블별 행 수·해당 컬럼의 payload 바이트 수만 JSON으로 출력한다. schema12 이력까지 검증하며 읽기 전용 repeatable-read 트랜잭션을 사용한다.

이 수치는 MySQL 내부 후보만 다룬다. SQL 덤프·볼륨 스냅샷·백업 보관소·애플리케이션/프록시 로그·클라이언트 캐시의 사본은 별도 inventory가 필요하다. 숫자 0은 과거 사본까지 정리됐다는 증명이 아니다.

## 남은 출시 조건

독립 암호 리뷰, 실제 두 PC 및 macOS 검증, 운영 서명 키/설치본, 사용자의 새 UI·이관 확인, 백업 보존 정책과 운영 데이터 정리/복원 승인은 별개다. 이번 리허설은 합성 DB에서만 수행했고 운영 DB·실제 계정·키·백업을 읽거나 변경하지 않았다.
