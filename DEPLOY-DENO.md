# Deploy the scalable relay to Deno Deploy (free, no cold start)

This is the recommended relay for online mode. It uses WebSockets, so peers get
pushed updates instead of polling every 4s — that's what lets it scale. It's
free, globally distributed, and never cold-starts.

Entry point: **`deno-relay/main.ts`**. No build step, no env vars, no database.

> ⚠️ This repo is a **mixed project**: a Vite/React frontend (root `package.json`)
> plus this Deno relay. Deno Deploy will try to *build the frontend* and fail
> unless you point it at the `deno-relay/` subfolder. The key setting below
> (**Root directory = `deno-relay`**) is what makes the build succeed.

> The app reads its relay URL from `src/config.js` (override: `VITE_RELAY_URL`).
> After deploying, copy your project's **stable** URL into that file and rebuild.

---

## Option A — Dashboard + GitHub (easiest, auto-deploys on push)

1. Push this repo to GitHub.
2. Go to your Deno Deploy dashboard → **New Project / App** → select the repo.
3. Set the build configuration:
   - **Root directory:** `deno-relay`   ← critical — avoids the frontend build
   - **Entrypoint:** `main.ts`
   - **Install command / Build command:** leave **empty**
   - **Framework preset:** None / Other
4. Deploy. You get a URL like
   `https://<project>.<org>.deno.net` (stable) plus per-deploy preview URLs that
   include a hash (e.g. `…-v988r5tg9n8c…`).

**Use the stable URL (no hash)** in `src/config.js` — preview URLs change on every
deploy. Every future `git push` redeploys automatically.

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
curl https://barternet-relay.x7oracle-commits.deno.net/ping
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
- **After changing the default URL** (your own deployment + `VITE_RELAY_URL`),
  rebuild: `npm run build` (web) and `npm run apk` (Android).
