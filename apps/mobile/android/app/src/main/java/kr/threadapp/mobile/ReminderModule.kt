package kr.threadapp.mobile

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONArray

// The app's side of the due reminders (#91): replace the schedule, report the permissions, open
// the system settings, and hand over the task a notification tap opened.
class ReminderModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "ThreadReminders"

  init {
    instance = this
  }

  @ReactMethod
  fun schedule(json: String) {
    val array = try { JSONArray(json) } catch (_: Exception) { return }
    val items = (0 until minOf(array.length(), MAX)).mapNotNull { ReminderStore.parse(array.optJSONObject(it)) }
    ReminderStore.replace(reactApplicationContext, items)
  }

  // Same shape as iOS: notifications allowed, and exact alarms (else a few minutes late). The
  // Android 13+ permission prompt itself is asked from JS (PermissionsAndroid).
  @ReactMethod
  fun status(promise: Promise) {
    val map = Arguments.createMap()
    map.putBoolean("enabled", NotificationManagerCompat.from(reactApplicationContext).areNotificationsEnabled())
    map.putBoolean("exact", ReminderStore.canExact(reactApplicationContext))
    promise.resolve(map)
  }

  @ReactMethod
  fun openNotificationSettings() {
    val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
      Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, reactApplicationContext.packageName)
    else Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + reactApplicationContext.packageName))
    reactApplicationContext.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  }

  @ReactMethod
  fun openExactAlarmSettings() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
    val intent = Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + reactApplicationContext.packageName))
    reactApplicationContext.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  }

  // The task of the notification that opened (or reopened) the app, once.
  @ReactMethod(isBlockingSynchronousMethod = true)
  fun takeOpenedTask(): String? {
    val tid = opened
    opened = null
    return tid
  }

  // RN's event emitter contract.
  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Double) {}

  companion object {
    // Android limits alarms per app (about 500 on some phones); the app plans at most this many.
    const val MAX = 300
    @Volatile private var opened: String? = null
    @Volatile private var instance: ReminderModule? = null

    // From MainActivity: a notification tap with its task.
    fun handle(intent: Intent?) {
      val tid = intent?.getStringExtra(ReminderReceiver.EXTRA_TASK) ?: return
      intent.removeExtra(ReminderReceiver.EXTRA_TASK)
      opened = tid
      val module = instance ?: return
      if (module.reactApplicationContext.hasActiveReactInstance())
        module.reactApplicationContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("ThreadReminderOpen", tid)
    }
  }
}
