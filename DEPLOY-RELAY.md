# Make BarterNet Online work anywhere (host the relay)

Online mode syncs over the internet through a tiny relay server (`relay-server.js`).

**A shared relay is already built into the app** (`src/config.js` →
`https://barternet.onrender.com`), so online mode works out of the box — users just
share a room code, no setup. The sections below are only for running **your own**
relay instead of the default.

To point every build at your own relay, set `VITE_RELAY_URL` (see `.env.example`)
and rebuild. Individual users can also override it in-app via Online → Change Server.

The relay uses only Node built-ins and reads `process.env.PORT`, so it runs on
almost any host with zero config.

## Option A — Render (free, easiest)

1. Push this project to a GitHub repo.
2. Go to https://render.com → New → Web Service → connect the repo.
3. Settings:
   - Build Command: *(leave empty)*
   - Start Command: `node relay-server.js`
4. Deploy. You get a URL like `https://barternet-xyz.onrender.com`.
5. In the app → Online → Set Server → paste that URL + a room code.

> Free Render services sleep after inactivity; the first request wakes it (~30s).

## Option B — Railway / Fly.io / Replit / Glitch

Same idea — create a Node service, start command `node relay-server.js`.
Each gives you a public `https://…` URL. Paste it into the app.

## Option C — Your own VPS / always-on PC

```
node relay-server.js
```
Expose port 4000 (open the firewall / port-forward, or put nginx in front for HTTPS).
Use `http://your-ip:4000` or your domain.

## Local testing (same WiFi only)

```
npm run relay
```
It prints `http://192.168.x.x:4000`. Enter that on phones on the same WiFi.

## Room codes

- People only see each other if they use the **same room code**.
- Use something shared, e.g. `kolkata-barter`, `our-village`, `family`.
- `global` is the default shared pool.

## Privacy note

The relay holds bundles in memory only and forgets each peer after 5 minutes of
inactivity. Nothing is written to disk. Images are stripped before any sync, so
only lightweight text (items, wants, offers, chat) travels.
