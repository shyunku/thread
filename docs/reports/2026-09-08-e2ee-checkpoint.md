# E2EE v1 implementation checkpoint

작성: 2026-09-08 17:15 (KST)

상태: 실험 구현. 기존 앱의 로그인·Sync v2·업데이트 경로에 연결되지 않았으며 E2EE 출시 사양으로 확정하지 않았다.

검증: Node 보안 테스트 12개, Electron 43 x64 보안 테스트 11개(고정 벡터 테스트 추가 전), 기존 Jest 52개 통과. production renderer 빌드 성공(기존 경고). frozen-lockfile 설치 성공. RMS 라우터는 구문 검사만 완료했으며 HTTP 배포 테스트는 아직 하지 않았다.

## #46: 업데이트 신뢰

- TUF 6.0.0의 root/targets/snapshot/timestamp 검증을 재사용한다.
- 앱에 내장할 오프라인 root가 없으면 UPDATE_TRUST_NOT_CONFIGURED. RMS에서 최초 root를 내려받아 신뢰하지 않는다.
- 기존 TUF cache를 유지하여 metadata rollback 이력을 보존한다.
- target 경로: win|mac / ia32|x64|arm64|universal / semver / installer.exe|installer.dmg.
- 서명된 target custom.thread: schema=1, platform, arch, version, mandatory(boolean). 최신/필수 알림에 unsigned 응답을 신뢰하지 않도록 연결해야 한다.
- 다운로드 후 실제 실행 직전 fresh metadata와 파일 hash/length를 다시 확인하는 API를 제공한다. 기존 updater 연결과 OS 배포 서명은 미완료다.
- RMS /tuf/metadata 및 /tuf/targets는 별도 tuf-repository 폴더의 공개 산출물만 제공한다. 기존 admin 업로드 경로와 분리한다. root 개인키를 이 폴더나 서버 env에 넣지 않는다.
- 운영 root/역할별 서명키/threshold/rotation 정책, signed repository 생성 파이프라인, Compose 영속 볼륨 및 실제 서명 배포는 남아 있다.

## #47: 암호 포맷 초안

- canonical CBOR: null/bool/안전한 정수/문자열/byte string/배열/plain map만 허용. float/tag/undefined와 비정규 인코딩 거부. 최대 1MiB, 깊이 24.
- HKDF-SHA256: IKM=32-byte secret, salt=UTF8(thread-e2ee-v1), info=canonical CBOR([purpose, context]), L=32.
- AEAD: libsodium XChaCha20-Poly1305, 새 CSPRNG nonce 24 bytes.
- field context: vaultId, vaultEpoch, objectId, fieldSlot, keyGeneration, mutationId, deviceId. fieldSlot/keyGeneration은 nonnegative safe integer, 나머지는 문자열.
- field key는 purpose=field로 파생. AAD=CBOR([thread-e2ee-v1,context]).
- Ed25519 서명 범위: CBOR([thread-e2ee-v1,purpose,body]). genesis/membership/mutation/pairing-response 각각 다른 purpose.
- 공개키 pin genesis, membership revision+previous hash 체인, 조회 기기 쓰기 거부와 uint64 counter 재생 거부 구현. snapshot/CAS/원자적 counter 영속화는 #49/#51 범위다.
- 기기 전달: X25519 sealed box + 발신자 Ed25519 signature. 요청 전문·수신 공개키·만료 대조. 일회성 소비와 사용자 fingerprint 확인 UI는 #50에 연결해야 한다.
- 복구 secret은 32-byte CSPRNG. purpose=recovery와 vaultId/genesisFingerprint로 분리한 키로 keyring/복구 authority를 감싼다.
- [고정 테스트 벡터](../protocol/e2ee-v1-vector.json)는 공개 synthetic 값이다. nonce를 고정하는 것은 테스트에만 허용한다.
- Node/Electron JS 벡터 일치만 검증했다. Mobile의 독립 구현 검증·QR 전체 schema·외부 암호 리뷰는 미완료다.

## #48: 로컬 저장소

- SQLite3MultipleCiphers의 chacha20 전체 페이지 암호화 사용. SQLCipher 제품 자체라고 부르지 않는다.
- 새 파일만 exclusive 생성, user_version=1. 기존 데이터/알 수 없는 schema/잘못된 키는 자동 리셋하거나 덮어쓰지 않는다.
- confirmed/visible/outbox/recovery/search를 같은 암호화 DB에 저장한다. WAL 모드, synchronous FULL, temp_store MEMORY, mmap 비활성.
- DB 내부 scope에 environment/accountId/vaultId를 고정한다. 키 자체는 DB에 넣지 않는다.
- VaultSession은 재인증 실패 시 열지 않고 잠금/절전/유휴 5분 때 핸들 종료 및 renderer 정리 callback을 수행한다. 실제 OS 재인증 및 renderer store 정리 연결은 미완료다.
- Windows x64 Node 및 Electron 43에서 DB/WAL 평문 검사, 재열기, 잘못된 키/계정 거부, transaction rollback, 잠금 도중 인증 완료 경쟁 테스트 통과.
- better-sqlite3-multiple-ciphers 13.0.3은 N-API prebuild를 포함한다. pnpm8이 불필요한 gyp rebuild를 시도하므로 이 패키지만 neverBuiltDependencies로 명시했다.
- ia32 prebuild가 없어 기존 Windows 32비트 배포에 E2EE를 활성화할 수 없다. 2026-09-08 18:43 사용자 승인으로 x64 전용을 확정했고 [#48](../tasks/0048.md)에 패키지/교차 아키텍처 synthetic DB 검증을 기록했다. 실제 NSIS 덮어쓰기 검증은 별도다.
- LDK 파일 영속화/복구 확인 UI/기존 replica 연결/사용자 재인증/암호화 이관은 미완료. 원본 사용자 DB와 env는 읽거나 바꾸지 않았다.
