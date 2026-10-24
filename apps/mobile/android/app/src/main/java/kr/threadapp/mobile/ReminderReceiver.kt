package kr.threadapp.mobile

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

// Shows a due reminder (#91) when its alarm fires. A tap opens the app on that task.
class ReminderReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val id = intent.getStringExtra("id") ?: return
    val item = ReminderStore.take(context, id) ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
      context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
    ensureChannel(context)
    val open = Intent(context, MainActivity::class.java)
      .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      .putExtra(EXTRA_TASK, item.tid)
    val tap = PendingIntent.getActivity(context, item.id.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val notification = NotificationCompat.Builder(context, CHANNEL)
      .setSmallIcon(R.drawable.ic_stat_thread)
      .setContentTitle(item.title)
      .setContentText(item.body)
      .setCategory(NotificationCompat.CATEGORY_REMINDER)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setWhen(item.at)
      .setShowWhen(true)
      .setAutoCancel(true)
      .setContentIntent(tap)
      .build()
    NotificationManagerCompat.from(context).notify(item.id.hashCode(), notification)
  }

  companion object {
    const val CHANNEL = "due"
    const val EXTRA_TASK = "kr.threadapp.mobile.REMINDER_TASK"

    fun ensureChannel(context: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      val manager = context.getSystemService(NotificationManager::class.java)
      if (manager.getNotificationChannel(CHANNEL) != null) return
      manager.createNotificationChannel(NotificationChannel(CHANNEL, "기한 알림", NotificationManager.IMPORTANCE_HIGH).apply {
        description = "할 일의 기한 전과 기한 시각에 알려요."
      })
    }
  }
}

// Alarms do not survive a reboot or an app update; the stored reminders are set again.
class ReminderBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED,
      "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED" -> ReminderStore.rearm(context)
    }
  }
}
