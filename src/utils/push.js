// FCM push notifications (Android, via @capacitor/push-notifications).
//
// This is the "doorbell": when the app is minimized or closed, the WebSocket is
// frozen, so the relay sends an FCM push and Android wakes the device to show
// the notification in real time. The actual data still syncs over the relay the
// moment the app is opened.
//
// Requires google-services.json in android/app/ and a Firebase project (see
// FIREBASE-SETUP.md). On web / when not configured, everything here is a no-op.

import { Capacitor } from "@capacitor/core";

let token = null;

export function getPushToken() {
  return token;
}

/**
 * Initialise push. Calls onToken(token) once Android returns the FCM token
 * (also on refresh). onForeground(notification) fires when a push arrives while
 * the app is in the foreground (so we can decide whether to surface it).
 */
export async function initPush({ onToken, onForeground } = {}) {
  // FCM is Android-only in this app; the web build uses Web Push separately.
  if (!Capacitor.isNativePlatform()) return;

  let PushNotifications;
  try {
    ({ PushNotifications } = await import("@capacitor/push-notifications"));
  } catch {
    return; // plugin not available
  }

  try {
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== "granted") return;

    await PushNotifications.removeAllListeners();

    await PushNotifications.addListener("registration", (t) => {
      token = t.value;
      onToken?.(t.value);
    });
    await PushNotifications.addListener("registrationError", (e) => {
      console.warn("Push registration error:", e?.error || e);
    });
    // Foreground delivery — the app is open, so the in-app toast already covers
    // it; we hand it to the caller in case it wants to do something.
    await PushNotifications.addListener("pushNotificationReceived", (n) => {
      onForeground?.(n);
    });
    // Tapped from the tray — app comes to the foreground and syncs automatically.
    await PushNotifications.addListener("pushNotificationActionPerformed", () => {});

    await PushNotifications.register();
  } catch (e) {
    console.warn("Push init failed:", e?.message || e);
  }
}
