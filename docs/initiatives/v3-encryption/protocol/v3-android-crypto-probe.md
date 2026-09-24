# Android crypto probe

Updated: 2026-09-09 14:04 (KST).

This separate synthetic probe exercises native libsodium against the committed
desktop AEAD/HKDF/Ed25519 fixtures. It does not log in, contact a server, read
personal data, migrate an account, or validate the ordinary mobile application.

## Build

From `apps/mobile/android`, with a compatible JDK (locally tested with JDK 18):

```powershell
$env:THREAD_E2EE_PROBE = "1"
.\gradlew.bat --no-daemon -PthreadE2eeProbe -PthreadCryptoProbe :app:assembleE2eeProbe
```

The crypto entry is `tests/protocolProbe.js`. Omitting `-PthreadCryptoProbe`
builds the separate key-storage test entry. Both use application ID
`kr.threadapp.mobile.e2eeprobe` and the **same output path**:
`app/build/outputs/apk/e2eeProbe/app-e2eeProbe.apk`.
Always rebuild the intended entry before installation. Unset the environment
flag for ordinary builds.

This build succeeded for all four configured Android ABIs. Its SHA256 is
`6134daa8243a25beb5caa0288cb974afbb4eab5f01de8c613fd5babc8c4cd22c`.
It has **not been installed or run on the user's phone** in this checkpoint.
The user's earlier key-storage test success does not verify this new crypto probe.

Expected native result after a separately authorized installation:
`CRYPTO_VERIFIED`. Failure is `CRYPTO_FAILED`; the probe emits fixed diagnostic
labels only. Android native primitive execution and iOS remain unverified.

## Compatibility changes

- RN remains 0.71.3; minimum Android remains API 23.
- Native libsodium 1.7.0, cborg 4.2.9 and noble hashes 1.8.0 are pinned.
- A pnpm patch normalizes Windows node_modules paths to forward slashes before
  passing them to CMake. Without this, CMake interprets drive-path backslashes as
  invalid escapes.
- Node interoperability tests exercise the mobile codec/HKDF implementation with
  an injected desktop libsodium backend. They verify serialization and protocol
  interoperability, not native Android/iOS runtime behavior.
