package kr.threadapp.mobile

import android.os.SystemClock
import android.provider.Settings
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

// Identifies the current device boot so the vault can ask for authentication
// again after a reboot (and only then, apart from a manual lock).
class BootInfoModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "ThreadBootInfo"

  @ReactMethod(isBlockingSynchronousMethod = true)
  fun getBootId(): String {
    val count = Settings.Global.getInt(reactApplicationContext.contentResolver, Settings.Global.BOOT_COUNT, -1)
    if (count >= 0) return "count:$count"
    // Fallback: boot time rounded to a minute (clock changes can shift it; that only causes an extra prompt).
    val bootMinute = (System.currentTimeMillis() - SystemClock.elapsedRealtime()) / 60000
    return "time:$bootMinute"
  }
}
