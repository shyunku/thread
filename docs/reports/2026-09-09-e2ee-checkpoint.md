# E2EE 구현 체크포인트

기록: 2026-09-09 11:07 (KST). 브랜치: feat/e2ee-vault.

최신 검증: 2026-09-09 11:50 (KST). Android 독립 키 저장소 APK 빌드 성공. 실제 기기 인증 검증은 사용자 대기이며 전체 #47~56은 여전히 WIP다. [설치·검증 절차](../protocol/android-keychain-probe.md).

## 현재 동작과 작업 경계

기존 앱은 여전히 Sync v2다. 아래 코드는 대부분 통합 전 기반 구현이며 #47~56을 DONE으로 처리하지 않는다. 실제 로그인/조회/편집의 E2EE 전환, 운영 DB 마이그레이션, 기존 평문 삭제, 서버 재시작, 배포는 수행하지 않았다.

API의 RegisterPending은 테스트 가능한 handler 묶음일 뿐 기존 production router에서 호출하지 않는다. 암호문 push/pull/snapshot은 현재 Store 메서드이며 아직 공개 HTTP 경로가 아니다. active-vault 해지/복구는 키 회전 transaction이 완성되기 전까지 거부한다.

## 구현 및 미완료 범위

| Task | 이번 구현·검증 | 남은 범위 |
| --- | --- | --- |
| #47 | fxamacker/cbor 2.9.3 + Go Ed25519 검증. Desktop 생성 genesis CBOR/서명/fingerprint를 Go가 독립 검증. 중복 키·비정규 표현·unsafe integer 거부. | 모바일 암호 primitive/codec 구현 및 외부 보안 리뷰. |
| #48 | 암호화 DB의 bounded entries 추가; outbox/journal 저장에 재사용. 이전 Win+L 실검증은 정상 기록 유지. | 실제 앱 연결 및 전체 잠금 UX. |
| #49 | 계정별 signed genesis, pending 기기 추가/해지/복구 authority 교체, CAS, 동일 event 재시도, immutable 원본 이력 조회. HTTP auth/크기/type/error 경계. | active key rotation/envelope 동시 커밋, 사용자 UI/실서비스 연결, 경쟁 쓰기 부하 검증. |
| #50 | 서명된 요청 파일과 QR 문자열, 수신자 전용 sealed response, fingerprint 확인·재인증·10분 만료·변조/다른 기기 거부. | QR 렌더링/카메라/파일 dialog, 역방향 초대, 승인 event의 서버 커밋 후 전달, 실제 두 기기 연결 UI. |
| #51 | migration 7/8 추가. full-object signed batch, durable receipt, uint64 counter/seq, 원자적 CAS, tombstone, bounded pull, immutable snapshot 복사 및 원본 서명 보존. | HTTP/sync loop 연결, quota/expiry cleanup, snapshot import/성능 및 광범위 경쟁 테스트. |
| #52 | 암호화 draft/outbox/visible 분리, nonce를 바꾸지 않는 재전송, ACK 전 confirmed 유지, 검증 후 순차 반영, conflict 사본 보관, 재시작/잠금 중 prepare 테스트. | 기존 할 일 UI/반복/DST/필드 충돌 자동 병합. 현재 같은 객체의 pending 중 추가 enqueue는 거부하며 삭제하거나 덮어쓰지 않는다. |
| #53 | 사용자 Android 실기기 보유 및 Android 6+ 승인. minSdk 23, compileSdk 34(target 33 유지), keychain 10.0.0 설치. scope/재인증 강제 key provider와 mock 회귀. Kotlin 모듈 컴파일 성공. | 독립 검증 APK 빌드/실기기 인증, 모바일 암호 codec/암호화 replica/실제 조회 연결. iOS 검증 미실행. |
| #54 | 암호화 로컬 migration journal, 단계 CAS/checkpoint, ACK 유실 뒤 일치하는 상태 재조회, 원본 비삭제 테스트. | 실제 freeze/manifest/readback/commit 서버 및 v2 객체 변환. journal의 evidence 플래그는 검증 엔진의 대체물이 아니다. |
| #55 | 복구 authority 서명 검증, 신규 기기/authority/generation 교체(pending만), checksum 복구 코드 및 recipient scope가 묶인 암호화 bundle 파일 codec. | active 데이터 키 회전·재암호화·retention, 실제 사용자 복구 UI/백업 내보내기/가져오기. |
| #56 | IPC/HTTP 공통 wrapper의 인수·응답·raw error/URL 로그 제거. 상태/메서드 등 운영 정보만 기록. 설정에 현재 v2는 E2EE가 아니며 과거 백업 정리는 별개임을 표시. | 전체 로깅/알림 경로 audit, E2EE 활성 후 동적 보호 상태/복구/이관 UX. |

## 프로토콜 경계

- 서명은 canonical CBOR [thread-e2ee-v1, purpose, body]의 Ed25519다. Go/JS 동일 genesis vector를 docs/protocol/e2ee-genesis-vector.json에 저장했다. private signing seed는 서버 구현에 포함하지 않는다.
- 기존 Desktop prototype과 맞추어 signed membership revision/generation은 0..2^53-1 범위 정수다. counter/seq/object version은 uint64 decimal string으로 전달한다. 과거 서버 기반 문서의 모든 숫자를 uint64 string으로 전달한다는 예고는 이 규칙으로 구체화했다.
- Batch body: schema=1, vaultId, deviceId, epoch, membershipRevision, keyGeneration, counter, mutationId, operations. 1..100개 operation, 각 objectId/baseVersion/deleted/fields. fields는 1..256개의 slot/24-byte nonce/ciphertext이며 tombstone은 fields=[].
- 전체 object 대체 + baseVersion CAS이므로 서버에서 필드 의미를 해석하지 않는다. 충돌은 client recovery/merge 대상으로 남긴다. tombstone의 같은 ID 재생성은 허용하지 않는다.
- Snapshot의 digest는 페이지/복사 무결성 checksum이며 서버의 정직성 서명이 아니다. 각 값의 원본 device 서명과 이력 검증이 필요하며 악성 서버의 누락/분기 전체 탐지를 보장하지 않는다.
- Pairing proposal은 서버에 커밋된 승인이 아니다. caller는 membership CAS 성공 이후에만 transfer를 공개해야 한다. 파일 codec의 테스트 성공을 실제 기기 연결 완료로 간주하지 않는다.

## 검증

- Desktop 보안/동기화/키/IPC 선택 회귀 40개 통과.
- React 12 suites / 56 tests 통과. production renderer build 성공(기존 ESLint 경고 있음).
- Go protocol/HTTP/migration 테스트 및 go vet 통과.
- 별도 mysql:8.0 tmpfs 컨테이너에서 signed genesis/변조/계정 격리/권한/복구 authority/ACK 재시도/암호문 batch rollback/immutable snapshot 보존 테스트 통과. 테스트 DB 이름은 thread_vault_test_*만 사용했다.
- Mobile key provider mock + 기존 v2 read replica 7개 통과. react-native-keychain compileDebugKotlin 성공; JVM target/Kotlin 중복 로딩 등 경고는 남아 있다.
- API Go 모듈 최소 1.20 / Docker builder 1.26.8로 조정. 기존 1.19 builder는 새 codec 요구사항을 충족하지 못했다. thread-api-e2ee-check:20260909 Docker build 성공; 실행하지 않았다. Docker context에서 .env.*도 제외한다.

## 모바일 설치 복구 및 검증 앱

기존 node_modules는 이전 C: Memorial virtual-store 경로를 참조했다. .tmp/mobile-deps-before-e2ee-20260909로 보존하고 재설치했다. pnpm 8 hoisted 모드에서는 존재하는 fsevents@2.3.3 entry를 구형 경로로 찾는 실패가 반복되어 isolated + shamefully-hoist로 기존 Gradle의 transitive package 경로를 제공했다. Metro 0.73의 symlink 해결에는 @rnx-kit/metro-resolver-symlinks 0.3.2를 추가했다. 중간 설치도 .tmp/mobile-deps-cstore-built-20260909에 보존했으며 현재는 기본 E: store를 사용한다. 일반 pnpm install --frozen-lockfile 및 probe Metro bundle은 성공했다. 전역 pnpm/Java 설정은 변경하지 않았다.

Android 검증 앱은 THREAD_E2EE_PROBE=1 및 -PthreadE2eeProbe를 동시에 요구한다. 별도 applicationId suffix .e2eeprobe, 고정 synthetic 키, 인터넷 권한 제거, dotenv plugin 비활성화, keychain 외 불필요한 native autolinking 제외로 기존 로그인/DB와 분리한다. 정상 app build는 probe 환경 없이 원래 dependency 설정을 사용한다.

키chain module 컴파일 후 APK에서 compileSdk 34 요구 오류를 확인해 compileSdk만 올렸다. Android 6(API23) 최소 지원 및 targetSdk33은 유지한다. APK의 설치/실기기 인증 성공을 아직 주장하지 않는다.

추가 기록 2026-09-09 11:31 (KST): 기존 AGP 7.3.1에서 AndroidX fragment 1.8.6 D8 오류와 Kotlin metadata 호환 오류로 APK 빌드가 실패했다. 사용자가 Gradle/AGP/Kotlin 정비를 승인하여 RN 버전을 유지한 빌드 도구 검증을 진행한다. 전체 Go 테스트는 printf 인수 전달 및 bool/category ID 오류를 수정한 뒤 통과했다. 별도 MySQL tmpfs 테스트 컨테이너는 검증 후 제거했으며 실제 Compose 데이터는 건드리지 않았다.

## 근거

### Android 빌드 정비 결과 (2026-09-09 11:50 KST)

- RN 0.71.3 유지. Gradle 8.4 / AGP 8.3.2 / Kotlin 1.9.22 / Build Tools 34.0.0. minSdk23, targetSdk33 유지.
- RN Gradle plugin 0.71.19의 내부 Kotlin compiler 1.6.10만 1.9.22로 바꾸는 pnpm patch를 고정했다. Keychain Java/Kotlin target17 정렬, RN generated resources와 아이콘 lint의 task dependency를 명시했다. 검증 앱에는 아이콘 폰트가 필요 없어 제외했다.
- 이전 AGP7.4 시도도 Kotlin1.9 AndroidX D8 변환에 실패했다. Gradle8의 명시적 task dependency 검증 오류도 수정했으며 검사를 끄거나 Kotlin metadata 검증을 생략하지 않았다.
- assembleE2eeProbe 성공(최종 증분 빌드 36초). frozen-lockfile 설치 성공. APK aapt 검증: kr.threadapp.mobile.e2eeprobe, min23, target33, 네 ABI, INTERNET 없음.
- APK SHA256: 239472e974801dfa2452e3e527a53aaaba4759f7c052b682f8892485a54ac9ac.
- 일반 모바일 전체 빌드/실행과 iOS는 검증 완료가 아니다. 이 APK는 고정 synthetic 키 provider 테스트일 뿐 E2EE 동기화 클라이언트가 아니다.
- 2026-09-09 11:53 KST: 기존 native library의 BuildConfig 생성 및 manifest에 선언된 namespace를 유지하도록 AGP8 호환 설정을 추가했고, probe 환경 없이 일반 Gradle help 구성 검증이 성공했다. APK 서명 검증도 통과했으며 v1 META-INF 경고는 남아 있다.

- [fxamacker CBOR 공식 문서](https://pkg.go.dev/github.com/fxamacker/cbor/v2): canonical encoder와 bounded strict decoder.
- [Go 공식 release history](https://go.dev/doc/devel/release): 1.26.8 builder 선택.
- [Keychain v10 Android 설정](https://github.com/oblador/react-native-keychain/blob/v10.0.0/android/gradle.properties): API23 및 native build 요구사항.
