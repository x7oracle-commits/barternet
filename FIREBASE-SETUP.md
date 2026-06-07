# Push notifications (FCM) setup

Background notifications on Android require Firebase Cloud Messaging. The app +
relay code is already written; this is the one-time setup only you can do (it
needs a Google account). ~10 minutes, free.

There are **two files** you produce here:
- `google-services.json` → goes in the **app** (`android/app/`).
- a **service-account key** → goes in the **relay** (Deno Deploy env var).

---

## 1. Create a Firebase project
1. Go to **https://console.firebase.google.com** → **Add project**.
2. Name it (e.g. `barternet`) → continue (Google Analytics optional, you can skip it) → **Create project**.

## 2. Add the Android app → get `google-services.json`
1. In the project, click the **Android** icon ("Add app").
2. **Android package name:** `com.barternet.app`  ← must be exactly this.
3. (Nickname/SHA-1 optional — skip.) Click **Register app**.
4. **Download `google-services.json`** and place it at:
   ```
   android/app/google-services.json
   ```
5. Skip the remaining SDK steps (the code's already done). 

## 3. Get the service-account key (for the relay to send pushes)
1. Firebase Console → ⚙️ **Project settings** → **Service accounts** tab.
2. Click **Generate new private key** → confirm → a **JSON file downloads**. Keep it secret.

## 4. Give the key to the relay (Deno Deploy)
1. Open your Deno Deploy project → **Settings → Environment Variables**.
2. Add a variable:
   - **Name:** `FCM_SERVICE_ACCOUNT`
   - **Value:** paste the **entire contents** of that service-account JSON file (the whole `{ ... }`).
3. Save. (Redeploy if it doesn't pick it up automatically.)

> Verify: `curl https://barternet-relay.x7oracle-commits.deno.net/ping` should now show `"push":true`.

## 5. Rebuild & reinstall the app
With `google-services.json` in place:
```
npm run apk
```
Install the new APK (clean install). On first launch it asks for notification
permission — allow it.

---

## How it behaves
- **App open** → real-time sync over the relay, in-app toasts (as now).
- **App minimized / closed** → the relay sends an FCM push; Android shows the
  notification on the lock screen / shade. Opening it syncs the actual data.
- Pushes fire for **new chat messages, trade offers, and buzzes**.

## Notes
- If `FCM_SERVICE_ACCOUNT` is unset or `google-services.json` is missing,
  everything still works — you just don't get background notifications (no
  crashes, no errors).
- The web (GitHub Pages) version doesn't use FCM; background notifications there
  would use Web Push (VAPID) — a separate add-on if you want it later.
