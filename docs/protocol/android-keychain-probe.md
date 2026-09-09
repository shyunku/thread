# Android key-storage probe

Updated: 2026-09-09 11:36 (KST). Task #53; real-device verification pending.

Build verified: 2026-09-09 11:50 (KST), Gradle 8.4 / AGP 8.3.2 / Kotlin 1.9.22, RN 0.71.3 unchanged. APK SHA256: `239472e974801dfa2452e3e527a53aaaba4759f7c052b682f8892485a54ac9ac`. This does not verify the ordinary mobile app build.

This is not the mobile E2EE client. It has a separate application ID (`kr.threadapp.mobile.e2eeprobe`), no INTERNET permission, no account login, and only a fixed synthetic test key. The existing Thread application and its data are not replaced.

## Build

From `apps/mobile/android`, with a Gradle-compatible JDK (tested locally with JDK 18):

```powershell
$env:THREAD_E2EE_PROBE = "1"
.\gradlew.bat --no-daemon -PthreadE2eeProbe :app:assembleE2eeProbe
```

The environment flag and Gradle property must both be present. The probe disables the dotenv Babel plugin and unrelated native modules. Unset the environment flag before ordinary builds. Output: `app/build/outputs/apk/e2eeProbe/app-e2eeProbe.apk` (only usable after a successful build).

## Device verification gate

1. Use an Android 6+ device with screen-lock PIN/password and, where available, enrolled biometrics. Install the probe APK, not a normal Thread release.
2. Tap `테스트 키 생성` and complete any OS authentication. Expected: `CREATED` (or already created on repeat; existing keys must not be overwritten).
3. Tap `OS 인증 후 키 읽기`, approve authentication. Expected: `VERIFIED`.
4. Wait at least 10 seconds, retry reading, and cancel OS authentication. Expected: `AUTH_FAILED_OR_CANCELLED`, never `VERIFIED`. The native library can reuse a short OS authentication window; an immediate retry is not a valid cancellation test.
5. Force-close and reopen the probe, then authenticate to read. Expected: `VERIFIED`; no key recreation required.
6. Background or lock the device: visible status should reset to `LOCKED`. This synthetic probe does not validate production vault/database lifecycle integration.

Report the device Android version and which numbered step failed; do not send PINs, passwords, or key material. Stop implementation at this verification gate. Removing only this probe app discards its synthetic key, not existing Thread data. iOS remains unverified.
