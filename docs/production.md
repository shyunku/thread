# Thread 운영 가이드

작성: 2026-09-30 16:45 (KST)

Thread 서버를 운영하고 데스크톱 앱을 배포할 때의 절차와 주의사항이다. 명령 세부와 도구 동작은 링크된 문서가 기준이다. 이 문서와 코드가 다르면 코드를 따르고 이 문서를 고친다.

> **먼저 읽기:** [10. 주의사항](#10-주의사항)은 되돌릴 수 없는 사고를 막기 위한 규칙이다. 배포나 키 작업 전에는 매번 확인한다.

관련 문서:
- [Windows 서명 업데이트 운영 절차](initiatives/v3-encryption/v3-update-operations.md): 키, TUF 저장소, 게시 도구의 세부 사항
- [업데이트 서명 정책](initiatives/v3-encryption/protocol/v3-update-signing-policy.md)
- [v3 평문 정리 계획](initiatives/v3-encryption/protocol/v3-plaintext-purge-plan.md), [암호화 백업](initiatives/v3-encryption/protocol/v3-encrypted-data-backup.md)
- [Task 64](tasks/0064.md): 현재 배포 진행 상태

## 1. 운영 구성

EC2 호스트 한 대에서 Docker Compose(프로젝트 이름 `thread`)로 서버를 실행한다. 모든 포트는 `127.0.0.1`에만 열린다. 외부 공개는 호스트의 Cloudflare Tunnel이 담당한다. TLS는 Cloudflare에서 종료하므로 `USE_HTTPS=false`로 둔다.

| Compose 서비스 | 역할 | 호스트 포트 | 영속 데이터 |
| --- | --- | --- | --- |
| `mysql` | MySQL 8.0. API와 RMS가 같은 DB를 쓴다 | `127.0.0.1:3309` (SSH 터널 접속용) | `mysql-data` |
| `redis` | 로그인 세션(refresh token 회전·폐기) | 없음 | `redis-data` |
| `app-server` | Go API. 인증, v3 암호문 동기화 | `4033` (`https://api.threadapp.kr`) | 없음 |
| `rms` | 릴리스 관리 서버. 구 방식 릴리스와 `/tuf/` 서명 저장소 | `4034` (`https://rms.threadapp.kr`) | `rms-releases`, `rms-tuf`(읽기 전용 마운트) |
| `site` | 공개 웹사이트 | `3000` | 없음 |
| `admin-site` | 관리자 웹 | `3001` | 없음 |

클라이언트:
- **데스크톱**: Windows x64만 배포한다. 새 버전은 RMS의 `/tuf/` 서명 저장소를 30초마다 확인한다.
- **모바일**: 아직 v2 조회만 구현되어 있어 v3 서버와 동기화되지 않는다(#53). 배포 대상이 아니다.
- **macOS**: 검증 전이다(#63). 배포하지 않는다.

## 2. 비밀정보와 파일 위치

| 무엇 | 위치 | 비고 |
| --- | --- | --- |
| 운영 서버 환경 변수 | 호스트의 저장소 루트 `.env` | DB, JWT, 관리자 계정, Google OAuth. Git에 넣지 않는다. 로컬 개발 PC에서는 `.env`(개발)와 `.env.production`(운영 값)을 나눠 두지만, 운영 서버에는 운영 값이 든 `.env` 하나만 둔다 |
| 데스크톱 운영 설정 | `apps/desktop/.env.production` | 공개 endpoint만 둔다. 설치 파일에 포함되므로 비밀값 금지 |
| 업데이트 서명 키 | 서명 PC의 `%USERPROFILE%\.thread-trust\trust-YYMMDD-HHMM\` | [7장](#7-서명-키-관리) 참고 |
| root 비밀번호 | 비밀번호 관리자와 종이 | 어떤 파일에도 저장하지 않는다 |
| Windows 코드 서명 인증서 | 사용하지 않음 | 선택 사항이다([6.2](#62-빌드-키가-있는-windows-pc)) |
| 릴리스 계획, TUF 저장소 생성 결과 | 로컬 저장소의 `.local\release\` (`plan-N.json`, `repo-N`) | Git과 Docker 빌드에서 제외된다. 저장소는 공개 파일이며 서버 `rms-tuf` 볼륨에도 있다 |

운영 `.env`의 `E2EE_*` 값은 현재 코드에서 쓰지 않는다. 남아 있어도 동작에는 영향이 없다.

## 3. 서버 일상 운영

모든 명령은 호스트의 저장소 루트에서 실행한다. Compose는 같은 폴더의 `.env`를 자동으로 읽는다. **`.env`가 없거나 값이 빠지면 개발용 기본값(`thread-dev-password` 등)으로 뜬다.** 명령 전에 운영 `.env`가 있는지 확인한다.

```bash
# 상태, 로그
docker compose ps
docker compose logs -f --tail=200 app-server

# 전체 기동, 재기동
docker compose up -d --build
docker compose restart rms

# 중지 (볼륨 유지)
docker compose down
```

- 관리자 웹의 API/RMS 주소는 **빌드할 때** 들어간다. `ADMIN_APP_SERVER_ENTRY`, `ADMIN_RMS_ENTRY`를 바꾸면 `admin-site`를 다시 빌드한다.
- DB에 직접 접속할 때는 SSH 터널로 `127.0.0.1:3309`를 쓴다. 가능하면 SELECT 권한만 있는 계정을 쓴다.

## 4. DB 백업과 복원 확인

서버 배포, 스키마 변경, 데이터 정리 전에는 **반드시** 백업하고, 복원까지 확인한 뒤 진행한다.

```bash
# 백업. 서버 저장소 안에서 실행한다(pnpm이 없으면 sh scripts/db-backup.sh)
pnpm db:backup

# 복원 확인: 운영과 분리된 임시 MySQL에 복원하고 테이블과 행 수를 비교한 뒤 삭제
docker run -d --name thread-restore-check -e MYSQL_ROOT_PASSWORD=restore-check -e MYSQL_DATABASE=thread mysql:8.0
# 초기화가 끝날 때까지 대기 (mysqld: ready for connections 로그가 두 번 나올 때까지)
docker logs -f thread-restore-check
docker exec -i thread-restore-check sh -c 'exec mysql -uroot -prestore-check thread' < .local/db-backups/thread-YYYYMMDD-HHMMSS.sql
docker exec thread-restore-check mysql -uroot -prestore-check thread -e "SELECT version,state FROM thread_schema_migrations"
docker rm -f thread-restore-check
```

- `db:backup`은 `.env`가 없거나 `mysql` 서비스가 꺼져 있으면 멈춘다. 결과는 `.local/db-backups/thread-YYYYMMDD-HHMMSS.sql`(본인만 읽기 권한)이다. 덤프 끝 표시(`-- Dump completed`)가 없으면 실패로 처리하고 파일을 남기지 않는다. `.local`은 Git과 Docker 빌드에서 제외되어 있다.
- 백업 파일에는 v2 평문 데이터가 들어 있다. 호스트 밖으로 옮길 때는 암호화된 저장소에만 둔다.
- 백업 사본을 Codex나 Claude에 넘기면 원문을 출력하지 않는 격리 복원 리허설을 맡길 수 있다.
- Redis는 로그인 세션만 담는다. 데이터를 잃으면 모든 기기가 다시 로그인하면 된다. Redis가 멈추면 로그인·토큰 갱신과 인증이 필요한 API가 모두 503을 반환한다(세션 확인 없이 통과시키지 않는다).

## 5. 서버 배포

`app-server`는 **시작할 때 DB 스키마 마이그레이션을 자동 실행한다.**
- `thread_schema_migrations`에 버전과 체크섬을 기록한다.
- MySQL 잠금으로 동시 실행을 막는다. 제한 시간은 2분이다.
- 실패하면 `applying` 표시를 남기고 서버가 종료된다. 이 표시가 있으면 자동으로 재실행되지 않는다. **DB를 되돌리는 기능은 없다.** 부분 실패는 백업 복원으로만 복구한다.

순서:
1. `git pull`로 배포할 커밋을 받는다. 실행 중인 서비스는 아직 바뀌지 않는다.
2. [4장](#4-db-백업과-복원-확인)대로 백업하고 복원을 확인한다.
3. 기존 API를 멈춘다. 옛 버전과 새 버전 API를 동시에 띄우지 않는다.
   ```bash
   docker compose stop app-server
   ```
4. 새 API를 빌드하고 기동한다.
   ```bash
   docker compose up -d --build app-server
   docker compose logs --tail=200 app-server
   ```
   로그에서 `Database schema version: N`을 확인한다. `Database schema migration failed`가 보이면 즉시 멈추고 [11장](#11-장애-대응)을 따른다.
5. 나머지 서비스를 반영한다. `docker compose up -d --build`
6. 설치된 데스크톱 앱으로 로그인, 잠금 해제, 편집, 동기화를 확인한다.

## 6. 데스크톱 릴리스

### 6.1 버전 규칙
- `apps/desktop/package.json`의 `version`을 올린다. 한 번 게시한 버전 번호는 다시 쓸 수 없다.
- **beta 버전(`x.y.z-beta.N`)은 필수 업데이트로 지정할 수 없다.** 구버전 사용을 막아야 하면 정식 버전으로 낸다.
- 필수(`mandatory: true`)로 게시한 버전은 이후 저장소에서도 필수로 유지된다. 그보다 낮은 버전의 앱은 그 버전 이상으로 올라가야 계속 쓸 수 있다.

### 6.2 빌드 (키가 있는 Windows PC)
1. `apps/desktop/public/resources/update-trust/root.json`이 현재 root와 같은지 확인한다. 다르거나 없으면 빌드가 중단된다.
2. 빌드한다. `pnpm build:desktop`
3. Windows 코드 서명은 **하지 않는다**(2026-09-30 결정). Thread는 Windows 코드 서명을 쓴 적이 없다.
   - 앱 안에서 받는 업데이트에는 SmartScreen 경고가 뜨지 않는다. 경고는 브라우저로 받은 파일에만 뜬다.
   - 브라우저로 설치 파일을 받아 처음 설치하면 "Windows의 PC 보호" 경고가 뜬다. "추가 정보 → 실행"으로 넘어간다.
   - 업데이트 파일의 진위는 TUF 서명으로 따로 검증되므로, 코드 서명이 없어도 업데이트 보안은 유지된다.
   - 나중에 인증서(유료)를 도입하면, 서명한 뒤 `Get-AuthenticodeSignature <설치파일>`로 확인하고 지문(Thumbprint)을 6.3에 쓴다.

### 6.3 TUF 저장소 생성과 검증
계획 파일과 결과 저장소는 Git에서 제외된 `.local\release\`에 둔다(`plan-N.json`, `repo-N`). `.local`은 Docker 빌드 재료에서도 제외되어 있다. 계획 파일에는 비밀값 없이 경로만 적는다.

```json
{
  "root": "C:\\Users\\<me>\\.thread-trust\\trust-YYMMDD-HHMM\\root.json",
  "keys": {
    "targets": "C:\\Users\\<me>\\.thread-trust\\trust-YYMMDD-HHMM\\targets.pem",
    "snapshot": "C:\\Users\\<me>\\.thread-trust\\trust-YYMMDD-HHMM\\snapshot.pem",
    "timestamp": "C:\\Users\\<me>\\.thread-trust\\trust-YYMMDD-HHMM\\timestamp.pem"
  },
  "passphrases": "C:\\Users\\<me>\\.thread-trust\\trust-YYMMDD-HHMM\\release-passphrases.json",
  "output": "<저장소>\\.local\\release\\repo-N",
  "version": N,
  "releases": [{ "file": "<저장소>\\apps\\desktop\\dist\\Thread Setup 2.0.1.exe", "platform": "win",
                 "arch": "x64", "version": "2.0.1", "mandatory": false }],
  "previous": "<저장소>\\.local\\release\\repo-(N-1)"
}
```
- 첫 게시에는 `previous` 대신 `"bootstrap": true`를 쓴다.
- `version`은 이전 저장소보다 항상 커야 한다.
- `expires`를 생략하면 1년이다.

```powershell
cd apps/desktop
node scripts/updateRepository.cjs <저장소>\.local\release\plan-N.json
node scripts/verifyUpdateRepository.cjs <저장소>\.local\release\repo-N <저장소>\apps\desktop\public\resources\update-trust\root.json --no-authenticode
# 코드 서명 인증서를 쓰는 경우: --no-authenticode 대신 --authenticode <지문>
```

### 6.4 게시
1. `repo-N`의 `metadata/`와 `targets/`만 서버 저장소의 `.local/tuf-upload/repo-N/`으로 옮긴다. `READY`, 계획 파일, 키는 옮기지 않는다. `.local`은 Git과 Docker 빌드에서 제외되어 있다.
   ```powershell
   ssh <서버> "mkdir -p <서버 저장소>/.local/tuf-upload/repo-N"
   scp -r .local\release\repo-N\metadata .local\release\repo-N\targets <서버>:<서버 저장소>/.local/tuf-upload/repo-N/
   ```
2. 서버 저장소 루트에서 `rms-tuf` 볼륨에 복사한다. 클라이언트가 중간 상태를 덜 보도록 **설치 파일 → 메타데이터 → `timestamp.json`** 순서로 넣는다.
   ```bash
   docker run --rm -v thread_rms-tuf:/dst -v "$PWD/.local/tuf-upload/repo-N:/src:ro" alpine sh -c '
     mkdir -p /dst/metadata /dst/targets &&
     cp -r /src/targets/. /dst/targets/ &&
     for f in /src/metadata/*; do [ "$(basename "$f")" = timestamp.json ] || cp "$f" /dst/metadata/; done &&
     cp /src/metadata/timestamp.json /dst/metadata/timestamp.json'
   ```
3. 게시된 파일을 대조한다.
   ```powershell
   node scripts/verifyPublishedRepository.cjs https://rms.threadapp.kr/tuf <저장소>\.local\release\repo-N
   ```
4. 설치된 앱에서 업데이트 알림, 다운로드, 설치 후 재시작을 확인한다.
5. 서버의 `.local/tuf-upload/repo-N`을 지운다. 원본은 로컬 `.local\release\`에, 게시본은 볼륨에 있다.
6. 로컬 `.local\release\repo-N` 폴더는 보관한다. 다음 릴리스의 `previous`로 쓴다.

### 6.5 메타데이터 만료 갱신
새 릴리스가 없어도 **1년 안에** 다시 서명해 게시해야 한다. 만료되면 앱이 업데이트 확인에 실패한다. 앱 자체는 계속 쓸 수 있다. 방법은 6.3~6.4와 같고, `"releases": []`로 둔다.

## 7. 서명 키 관리

### 7.1 파일 구성
| 파일 | 공개 | 쓰는 때 |
| --- | --- | --- |
| `root.json` | 공개 | 앱에 포함, 저장소 생성 |
| `root.pem` | **비공개, 가장 중요** | root 갱신과 키 교체 |
| `targets.pem`, `snapshot.pem`, `timestamp.pem` | 비공개 | 릴리스와 만료 갱신마다 |
| `release-passphrases.json` | 비공개 | 위 세 키의 비밀번호. 릴리스 도구가 읽는다 |

### 7.2 백업
- **필수**: `root.pem`을 USB 두 개에 보관한다. root 비밀번호는 비밀번호 관리자와 종이에 둔다.
- **권장**: trust 폴더 전체도 함께 백업한다. 없으면 릴리스 키를 교체해야 한다(7.4).
- `~/.thread-trust`는 OneDrive 등 클라우드 동기화에서 제외한다.
- root 키를 교체(`--rotate-root-key`)했으면 **새 `root.pem`을 다시 백업한다.** 옛 백업으로는 새 root를 갱신할 수 없다.

### 7.3 만료 일정
| 대상 | 기본 기간 | 갱신 방법 |
| --- | --- | --- |
| root | 5년 | `pnpm cert:desktop:renew <trust 폴더>` 후 다음 저장소 생성, 게시 |
| targets / snapshot / timestamp 메타데이터 | 1년 | 6.5 |

**만료일을 달력에 등록하고, 한 달 전에 갱신한다.** root가 이미 만료됐더라도 키가 있으면 갱신할 수 있다. 다만 갱신본을 게시할 때까지 모든 앱이 업데이트를 받지 못한다.

### 7.4 root 갱신과 키 교체
```powershell
pnpm cert:desktop:renew <현재 trust 폴더> [만료일] [--rotate-release-keys] [--rotate-root-key]
```
1. 새 `trust-YYMMDD-HHMM` 폴더에 root N+1이 생긴다.
2. 새 폴더의 `root.json`과 키로 다음 저장소를 만든다. `previous`는 마지막 게시 저장소다. 게시는 6.3~6.4와 같다.
3. 새 `root.json`을 `apps/desktop/public/resources/update-trust/`에 복사하고 커밋한다. 이후 빌드에 들어간다.
4. 게시와 확인이 끝나기 전에는 이전 trust 폴더를 지우지 않는다.

| 상황 | 할 일 |
| --- | --- |
| root 만료가 다가옴 | 옵션 없이 `renew` |
| 릴리스 키 분실 | 폴더에 `root.json`, `root.pem`만 두고 `renew --rotate-release-keys` |
| 릴리스 키 유출 의심 | 즉시 `renew --rotate-release-keys`로 게시한다. 유출된 키는 새 root가 게시되는 순간 무효가 된다 |
| root 키 유출 의심 | 즉시 `renew --rotate-root-key --rotate-release-keys`. 공격자가 먼저 root를 바꿨다면 복구가 불가능하다. 새 설치 파일을 수동으로 다시 설치해야 한다 |
| root 키나 root 비밀번호 분실 | 도구로 복구할 수 없다. 새로 `cert:desktop:create`하고 새 설치 파일을 모든 사용자가 수동으로 설치해야 한다 |

## 8. 구버전 클라이언트

| 설치본 | 상태 | 조치 |
| --- | --- | --- |
| 1.x (v2 평문) | 서버의 `/v2/sync`가 없어 404가 난다 | 관리자 웹의 구 방식 릴리스(업로드, 검증, 알림 게시)로 새 설치 파일을 안내한다 |
| `2.0.0-beta.2` 등 root가 없는 v3 설치본 | 서명 업데이트를 받을 수 없다 | 새 설치 파일을 **한 번 수동으로** 설치한다 |
| root가 들어간 설치본 | `/tuf/`로 자동 안내 | 없음 |

관리자 웹의 릴리스 업로드는 8MiB 단위로 나눠 보낸다. RMS의 `rms-releases` 볼륨에 저장되고, `/tuf/` 서명 저장소와는 **별개**다. 관리자 웹 업로드로는 서명 저장소를 바꿀 수 없다.

## 9. 데이터 보존 정책

- **v2 평문 데이터와 과거 백업은 삭제하지 않는다.** 정리는 별도로 결정한 뒤에만 한다([정리 계획](initiatives/v3-encryption/protocol/v3-plaintext-purge-plan.md)). 정리 도구는 아직 없다.
- 남은 평문 양은 읽기 전용 도구로 확인한다. 원문은 출력하지 않는다.
  ```bash
  cd services/api
  THREAD_V3_INVENTORY_DSN='<SELECT 전용 DSN>' go run ./cmd/v3-legacy-inventory --user <UID>
  ```
- 암호화 백업 가져오기는 원본 DB를 덮어쓰지 않고 복구용 사본만 만든다.

## 10. 주의사항

### 되돌릴 수 없는 것
- [ ] **root 키 분실, 유출**: 모든 사용자가 수동으로 다시 설치해야 한다. `root.pem` 백업과 root 비밀번호 보관을 확인한다.
- [ ] **DB 마이그레이션 부분 실패**: 백업 복원 외에 복구 방법이 없다. 서버 배포 전 백업과 복원 확인은 생략하지 않는다.
- [ ] **게시한 버전 번호와 메타데이터 버전**: 같은 번호로 다시 게시할 수 없다. 번호를 낮춰서도 안 된다. 앱이 되돌림 공격으로 보고 거부한다.
- [ ] **필수 업데이트 지정**: 한 번 필수로 게시하면 이후 저장소에서도 필수로 유지된다.
- [ ] **v2 평문, 백업 삭제**: 별도 결정 전에는 하지 않는다.

### 비밀정보
- [ ] 개인키, 비밀번호, 계획 파일, `.env*`를 Git, CI, RMS, `rms-tuf` 볼륨, 클라우드 동기화 폴더에 두지 않는다.
- [ ] `release-passphrases.json`은 키와 같이 있으면 사실상 평문 키다. trust 폴더 전체를 비밀로 다룬다.
- [ ] 데스크톱 `.env.production`에는 공개 endpoint만 둔다. 설치 파일에 그대로 들어간다.
- [ ] 백업 SQL 파일에는 사용자 평문 데이터가 있다. 권한을 제한하고, 암호화된 곳에만 옮긴다.

### 배포 작업
- [ ] Compose 명령은 운영 `.env`가 있는 저장소 루트에서만 실행한다. 로컬 PC에서 운영 값으로 띄울 때만 `--env-file .env.production`을 붙인다.
- [ ] 옛 API와 새 API를 동시에 띄우지 않는다.
- [ ] 게시 전 `verifyUpdateRepository`, 게시 후 `verifyPublishedRepository`를 모두 통과시킨다.
- [ ] 게시하는 것은 `metadata/`와 `targets/`뿐이다. `READY`, 계획 파일, 키는 올리지 않는다.
- [ ] root 없는 설치 파일은 배포하지 않는다. 빌드 단계에서 막히지만, 우회하지 않는다.
- [ ] 모바일 앱과 macOS 앱은 v3 검증이 끝날 때까지 배포하지 않는다.

### 정기 점검
- [ ] 메타데이터 만료(1년)와 root 만료(5년)를 달력에 등록한다.
- [ ] 1년에 한 번, 백업한 `root.pem`이 root 비밀번호로 열리는지 확인한다. 백업 폴더로 `pnpm cert:desktop:renew`를 실행해 성공하면 된다. 이때 생긴 새 폴더는 게시하지 않고 지운다. 게시하지 않은 root는 효력이 없다.
- [ ] `docker compose ps`로 컨테이너 상태와 디스크 여유를 확인한다.

### 에이전트(Claude, Codex)에게 맡길 때
- [ ] 데스크톱 앱 실행은 secure 로그 모드(`pnpm dev:desktop:secure`, `--secure-logs`)로만 한다([AGENTS.md](../AGENTS.md)).
- [ ] 운영 DB, 개인 로그, `.env*`, trust 폴더는 명시적으로 허락한 범위만 열람하게 한다.
- [ ] 키 생성, 인증서 사용, 운영 배포, 데이터 삭제는 에이전트가 자동으로 하지 않는다. 사용자가 직접 실행하거나 매번 승인한다.

## 11. 장애 대응

| 증상 | 원인 후보 | 조치 |
| --- | --- | --- |
| `app-server`가 계속 재시작, 로그에 `Database schema migration failed` | 마이그레이션 실패 또는 이전 실패의 `applying` 표시 | 서버를 멈추고 로그를 확인한다. 부분 실패면 백업을 복원한 뒤 원인을 고치고 다시 배포한다. `thread_schema_migrations`를 직접 고치지 않는다 |
| 앱에서 업데이트 확인 실패 (`SIGNED_UPDATE_UNAVAILABLE`) | 메타데이터나 root 만료, `/tuf/` 게시 누락, 네트워크 | `verifyPublishedRepository`로 게시 상태를 확인한다. 만료면 6.5나 7.4 |
| 앱에서 `UPDATE_TRUST_NOT_CONFIGURED` | root 없이 빌드한 설치본 | root가 들어간 새 설치 파일을 수동으로 설치한다 |
| `verifyUpdateRepository` 실패 | 코드로 원인이 나온다 | `APP_ROOT_MISMATCH`: 앱 root와 저장소 root가 다르다. `AUTHENTICODE_CHOICE_REQUIRED`: `--no-authenticode`를 빠뜨렸다. `AUTHENTICODE_*`: 코드 서명 문제. `ROOT_HISTORY_MISSING`: 과거 root 누락 |
| `updateRepository` 실패 `ROOT_VERSION_GAP` | root를 두 번 이상 갱신하고 중간 버전을 게시하지 않았다 | 중간 root로 먼저 저장소를 만들어 게시한 뒤 다음 버전으로 진행한다 |
| 관리자 웹 로그인 불가 | `ADMIN_ID`, `ADMIN_PASSWORD` 누락 | 운영 `.env`를 확인하고 `app-server`를 재기동한다 |
| 1.x 앱 동기화 실패(404) | v2 동기화 종료 | 정상 동작이다. 새 버전 설치를 안내한다 |
