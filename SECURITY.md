# BarterNet — Security Model

BarterNet is decentralized and serverless-by-default: data hops between phones
over Bluetooth, files, or a dumb relay. There is no central authority to trust,
so trust is established **cryptographically, end to end**.

## Identity & authenticity

- On first launch each device generates an **Ed25519 keypair** (`src/utils/crypto.js`).
  The private key never leaves the device.
- A user's **peer id is the fingerprint of their public key** — identity is
  self-certifying. You cannot claim to be peer `X` unless you hold `X`'s key.
- Every outgoing bundle is **signed**. Receivers verify, before trusting anything:
  1. the signature is valid for the attached public key, **and**
  2. the public key's fingerprint equals the claimed `peer.id`.
- Authorship is enforced per record: a peer may only deliver chat messages,
  trade offers, and trade responses **authored by themselves**
  (`fromId === peer.id`), and may only respond to trades that are actually with
  them. This closes impersonation of messages/offers across the mesh.

Verification happens on the **raw transmitted bytes** before sanitization, so the
signed digest is never altered (`processMeshBundle` in `MeshContext.jsx`).

## Untrusted input

All peer data (BLE, relay, or imported file) is run through `validateBundle`
(`src/utils/validate.js`) before touching IndexedDB:

- counts capped (items, wants, mesh peers, messages, offers…),
- string lengths capped, control characters stripped,
- coordinates range-checked, images limited to `data:image/*` under a size cap
  (and dropped entirely on BLE/relay transports).

This bounds local storage growth and blocks oversized / malformed payloads.
React additionally escapes all rendered strings.

## Relay hardening (`relay-server.js`)

The relay is store-and-forward only and never interprets bundle contents
(authenticity is end-to-end). It defends against abuse with:

- per-IP rate limiting,
- a 1 MB request-body cap,
- room and per-room peer caps,
- 5-minute TTL expiry of idle peers.

## Data retention

Stale peers (not seen for 30 days) are pruned on launch (`pruneStalePeers`),
bounding IndexedDB growth from epidemic gossip.

## Known properties & deployment guidance

- **Within a room/mesh, members can see each other's listings and location.**
  That is the point of the app (matches need to find you). Treat a room code as a
  shared secret among a group.
- **Forwarded (2-hop) peer listings are discovery-only** and not individually
  signed; they can never carry messages/offers, so impersonation harm is limited
  to spoofed listings. Direct-peer data is always verified.
- **Use TLS for the hosted relay.** Deploy behind HTTPS (Render/Railway/Fly give
  this for free) so bundles aren't readable in transit. The app accepts `https://`
  URLs directly.

## Reporting

This is an offline-first hobby/community app. Report issues via the project's
issue tracker.
