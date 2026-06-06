# Deploy the scalable relay to Deno Deploy (free, no cold start)

This is the recommended relay for online mode. It uses WebSockets, so peers get
pushed updates instead of polling every 4s — that's what lets it scale. It's
free, globally distributed, and never cold-starts.

Entry point: **`deno-relay/main.ts`**. No build step, no env vars, no database.

> The app already defaults to `https://barternet-relay.deno.dev`. Name your
> project **`barternet-relay`** and it "just works" with no rebuild. Use a
> different name only if you also set `VITE_RELAY_URL` (see `.env.example`) and
> rebuild the app.

---

## Option A — Dashboard + GitHub (easiest, auto-deploys on push)

1. Push this repo to GitHub (you likely already did for Render).
2. Go to **https://dash.deno.com** → sign in with GitHub → **New Project**.
3. Select your repo. Set:
   - **Entry point:** `deno-relay/main.ts`
   - **Project name:** `barternet-relay`  ← must match for the baked-in default
   - Build command / install step: leave empty.
4. Click **Deploy**. In ~10s you get `https://barternet-relay.deno.dev`.

Every future `git push` redeploys automatically.

## Option B — CLI (deployctl)

```bash
# install Deno (if needed):  https://deno.com/  then:
deno install -gArf jsr:@deno/deployctl

# from the repo root:
deployctl deploy --project=barternet-relay --entrypoint=deno-relay/main.ts
```

It prints the live URL on success.

---

## Verify it works

```bash
curl https://barternet-relay.deno.dev/ping
# → {"app":"BarterNet-Relay","transport":"ws","room":"global","peers":0}
```

Then in the app: **Connect → Online**. It connects automatically (no URL to
enter). Two phones on the same room code now sync in real time.

## Notes

- **Security is unchanged.** The relay is a dumb, untrusted forwarder; bundles
  are opaque and Ed25519-signed end to end by the clients. The server only
  resists abuse (rate limits, size/room caps, 5-min TTL).
- **Cross-region:** a global `BroadcastChannel` fans each update out to every
  isolate, so peers on different edge locations still see each other.
- **Fallback:** if you ever point the app at a non-WebSocket relay (the old
  `relay-server.js` on Render, or a `http://192.168…` LAN box), the client
  detects there's no `/ws` and falls back to HTTP polling automatically.
- **After changing the default URL** (different project name + `VITE_RELAY_URL`),
  rebuild: `npm run build` (web) and `npm run apk` (Android).
```
