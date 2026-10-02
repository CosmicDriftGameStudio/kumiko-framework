---
"@cosmicdrift/kumiko-bundled-features": patch
---

The agent manifest reports a detail screen's configured `idParam` and builds its label index once per manifest. Handler tools whose names collide after sanitizing or truncation are no longer dropped; the later one gets a QN-hash suffix. The audit log search matches event types by substring instead of exact equality. Config bounds errors no longer echo an encrypted value. The MFA account label never falls back to the internal user id. The tenant caps list resolves limits in parallel.

<!-- kumiko-changes
feature: agent-tools
type: fix
title: agent tool name collisions are disambiguated, audit search is substring, encrypted config bounds errors do not echo the value
-->
