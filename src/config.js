// App-wide defaults.
//
// The relay URL is baked in so online mode works for everyone out of the box —
// no one has to paste a server address. It can still be overridden:
//   • at build time via the VITE_RELAY_URL env var (see .env.example), or
//   • per-device in the Connect screen ("Change Server").
//
// Default points at the Deno Deploy relay (deno-relay/, WebSocket — scalable,
// no cold start). The client auto-falls back to HTTP polling if a server has no
// WebSocket endpoint, so a Node/Render relay or a LAN address also works here.
// Deploy the Deno project named "barternet-relay" so this URL matches (see
// DEPLOY-DENO.md), or override with VITE_RELAY_URL.
export const DEFAULT_RELAY_URL =
  (import.meta.env.VITE_RELAY_URL || "https://barternet-relay.deno.dev").replace(/\/+$/, "");

// Everyone lands in the same room unless they pick another code.
export const DEFAULT_ROOM = "global";
