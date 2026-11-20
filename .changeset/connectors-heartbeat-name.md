---
"@cosmicdrift/kumiko-bundled-features": patch
---

The heartbeat answer of the connectors feature carries the connector name.

<!-- kumiko-changes
feature: connectors
type: improvement
title: The heartbeat answer carries the connector name
detail: `POST /v1/heartbeat` now answers `{"ok":true,"name":"<connector name>"}` with the name the admin gave when pairing, so a satellite can show "Paired as <name>". A satellite treats a missing `name` as "no name to show".
-->
