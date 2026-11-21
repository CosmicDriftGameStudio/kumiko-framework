---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

Review fixes for the connectors routes: honest loopback display, ordered storage-full flag, 409 for a vanished upload.

<!-- kumiko-changes
feature: connectors
type: fix
title: Connectors routes review fixes
detail: The pairing confirm step no longer claims a loopback request comes from "this server": it shows the address (`::1`, `127.x`) with the note "local address (proxy, real sender unknown)", and only the exact IPv6 loopback counts as local, not the rest of `::/64`. The storage-full flag is cleared only by an upload accepted after the refusal, so a late touch of an earlier upload cannot undo it, and a duplicate delivery no longer clears it. An upload whose file vanished while it was processed answers `409 {"error":"retry"}` instead of `500 server_error`. The `readInboundFile` docs state that it does no role check and that storage failures throw.
-->
