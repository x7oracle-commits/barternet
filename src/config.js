// App-wide defaults.
//
// The relay URL is baked in so online mode works for everyone out of the box —
// no one has to paste a server address. It can still be overridden:
//   • at build time via the VITE_RELAY_URL env var (see .env.example), or
//   • per-device in the Connect screen ("Change Server").
//
// Default points at the live Deno Deploy relay (deno-relay/, WebSocket —
// scalable, no cold start). This is the STABLE production URL (no per-deploy
// hash), so it survives redeploys. Override with VITE_RELAY_URL to point at your
// own deployment. See DEPLOY-DENO.md.
export const DEFAULT_RELAY_URL =
  (import.meta.env.VITE_RELAY_URL || "https://barternet-relay.x7oracle-commits.deno.net").replace(/\/+$/, "");

// Everyone lands in the same room unless they pick another code.
export const DEFAULT_ROOM = "global";
