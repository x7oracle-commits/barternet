// Local (device) notifications. These fire while the app is running — including
// when it's in the background — so the user is alerted to messages, matches,
// offers, trade responses and buzzes without staring at the screen.
//
// IMPORTANT: when the app is fully closed/swiped away, the WebView's JS stops,
// so nothing here runs. Delivery to a *closed* app needs FCM push (a Firebase
// project + the relay pushing) — a separate, server-driven feature.

import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

let granted = false;

export async function initNotifications() {
  if (!Capacitor.isNativePlatform()) {
    // Web fallback: ask the browser for Notification permission if available.
    try {
      if ("Notification" in window && Notification.permission === "default") {
        await Notification.requestPermission();
      }
      granted = "Notification" in window && Notification.permission === "granted";
    } catch { granted = false; }
    return;
  }
  try {
    const res = await LocalNotifications.requestPermissions();
    granted = res.display === "granted";
  } catch { granted = false; }
}

/** Post an OS notification. No-op if permission wasn't granted. */
export async function notify(title, body) {
  if (!granted) return;
  if (Capacitor.isNativePlatform()) {
    try {
      await LocalNotifications.schedule({
        notifications: [{
          id: Math.floor(Math.random() * 2_000_000_000),
          title,
          body,
          // omit smallIcon → plugin uses the app's default launcher icon
        }],
      });
    } catch { /* ignore */ }
  } else {
    try { new Notification(title, { body }); } catch { /* ignore */ }
  }
}
