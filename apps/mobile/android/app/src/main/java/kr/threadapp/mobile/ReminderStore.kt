package kr.threadapp.mobile

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject

// Due reminders (#91) planned by the app (packages/e2ee model/reminders) and handed over as a list.
// The list is kept in the app's private preferences so the alarms can be set again after a reboot
// or an app update. It holds the notification text: titles of ordinary tasks (the user chose to
// show them), never of secret ones (the app plans those without a title).
object ReminderStore {
  private const val PREFS = "thread-reminders"
  private const val KEY = "items"

  data class Item(val id: String, val tid: String, val at: Long, val title: String, val body: String)

  fun read(context: Context): List<Item> {
    val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null) ?: return emptyList()
    return try {
      val array = JSONArray(raw)
      (0 until array.length()).mapNotNull { i -> parse(array.optJSONObject(i)) }
    } catch (_: Exception) {
      emptyList()
    }
  }

  fun parse(o: JSONObject?): Item? {
    if (o == null) return null
    val id = o.optString("id")
    val tid = o.optString("tid")
    val at = o.optLong("at", 0)
    if (id.isEmpty() || id.length > 300 || tid.length > 300 || at <= 0) return null
    return Item(id, tid, at, o.optString("title").take(200), o.optString("body").take(300))
  }

  private fun write(context: Context, items: List<Item>) {
    val array = JSONArray()
    for (item in items) array.put(JSONObject().put("id", item.id).put("tid", item.tid).put("at", item.at).put("title", item.title).put("body", item.body))
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, array.toString()).apply()
  }

  private fun pending(context: Context, item: Item, flags: Int): PendingIntent? {
    val intent = Intent(context, ReminderReceiver::class.java).setAction("kr.threadapp.mobile.REMINDER").putExtra("id", item.id)
    return PendingIntent.getBroadcast(context, item.id.hashCode(), intent, flags or PendingIntent.FLAG_IMMUTABLE)
  }

  fun canExact(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
    return (context.getSystemService(Context.ALARM_SERVICE) as AlarmManager).canScheduleExactAlarms()
  }

  // Replaces every scheduled reminder with `items` (soonest first, already capped by the app).
  fun replace(context: Context, items: List<Item>) {
    cancel(context, read(context))
    val now = System.currentTimeMillis()
    val future = items.filter { it.at > now }
    write(context, future)
    arm(context, future)
  }

  // After a reboot or an update the alarms are gone; the stored list sets them again.
  fun rearm(context: Context) {
    val now = System.currentTimeMillis()
    val future = read(context).filter { it.at > now }
    write(context, future)
    arm(context, future)
  }

  private fun arm(context: Context, items: List<Item>) {
    val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val exact = canExact(context)
    for (item in items) {
      val intent = pending(context, item, PendingIntent.FLAG_UPDATE_CURRENT) ?: continue
      // Without the exact-alarm permission Android may deliver a few minutes late.
      if (exact) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, item.at, intent)
      else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, item.at, intent)
    }
  }

  private fun cancel(context: Context, items: List<Item>) {
    val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    for (item in items) pending(context, item, PendingIntent.FLAG_NO_CREATE)?.let { alarms.cancel(it); it.cancel() }
  }

  // The item an alarm fired for; it leaves the stored list.
  fun take(context: Context, id: String): Item? {
    val items = read(context)
    val item = items.firstOrNull { it.id == id } ?: return null
    write(context, items.filter { it.id != id })
    return item
  }
}
