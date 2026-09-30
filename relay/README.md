# Babbl clipboard relay

Tiny WebSocket relay used by Babbl's clipboard sync ("Internet via relay").

- Clients connect to `wss://<host>/ws/<room>`; every frame is forwarded to the other sockets in the same room.
- Babbl encrypts all frames end-to-end (XChaCha20-Poly1305 with the group key), so the relay never sees clipboard contents. Room names are derived from the group key and reveal nothing about it.
- `pair-*` rooms (PIN pairing) hold at most 2 sockets; group rooms at most 32.
- Limits: 12 MB per frame, 600 MB/min per socket, 40 connections per IP, 30 s heartbeat.

Deploy on Railway with this folder as the service root (`railway.json` included), then paste the public URL (e.g. `https://babbl-relay.up.railway.app`) into Babbl → Clipboard → Internet → Relay URL.

Run locally: `npm install && npm start` (listens on `$PORT`, default 8080).
