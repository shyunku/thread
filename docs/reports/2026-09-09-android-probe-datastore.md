# Android probe startup failure

Recorded: 2026-09-09 12:46 (KST). Task #53 remains WIP.

## Cause

On the user-approved Android 16 test device, the isolated `kr.threadapp.mobile.e2eeprobe` app terminated during keychain module construction with `NoClassDefFoundError: androidx.datastore.preferences.PreferenceDataStoreDelegateKt`. Only this app UID was queried; unrelated application logs were not collected. The observed memory page size was 4096 bytes, not 16 KiB.

Gradle dependencyInsight showed `datastore-preferences:1.1.1` selecting `jvmRuntimeElements-published` and `datastore-preferences-jvm`. The Java-only app module did not request Kotlin androidJvm attributes, even though the keychain library compiled against Android DataStore. Successful compilation and APK signing did not catch the missing runtime class.

## Fix and verification

- Apply `org.jetbrains.kotlin.android` to the app module using the already pinned Kotlin plugin. No RN, DataStore or keychain version change; no weaker key-storage fallback.
- assembleE2eeProbe succeeded in 62 seconds. dependencyInsight now selects `datastore-preferences-android:1.1.1`, `releaseRuntimeElements-published`, with requested/provided platform `androidJvm`.
- apkanalyzer `dex packages --defined-only` confirms the missing `PreferenceDataStoreDelegateKt` class is defined in the new APK.
- aapt confirms the separate probe package and absence of INTERNET permission. APK SHA256: `e18ee6b52f13bf43f6ef6c67893bc67a7286e9d10d89cb4f133ca1643799f247`.
- User approved wireless replacement of the probe only via `adb install -r`; no uninstall or data clearing. Device restart/authentication results are recorded below after verification. Pairing codes, device serial and LAN addresses are intentionally not retained here.

For future native-dependency changes, verify both resolved Android runtime variants and classes in the packaged DEX, then launch on a device. A successful Gradle build alone is insufficient. OS authentication success/cancel/restart scenarios remain a user-verification gate; this probe is not the completed E2EE mobile client.

## Device result — 2026-09-09 12:47 (KST)

Wireless replacement succeeded without clearing data. `am start -W` reported a successful cold launch (172 ms); the new process remained alive on a later check. Its scoped log showed React Native starting `thread_mobile` and no AndroidRuntime fatal error. No screen capture, unrelated app log collection, biometric approval, PIN entry, or key creation was performed. Stop here for the user to test authenticated key creation/read/cancel/reopen; this startup verification does not mark task #53 DONE.
