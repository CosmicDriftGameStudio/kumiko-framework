---
"@cosmicdrift/kumiko-dev-server": patch
---

dev-server: `createKumikoServer()` returns the boot's `jobQueueNamePrefix` on its handle, so callers sharing a Redis can address exactly that boot's `bull:<prefix>-*` keys.

<!-- kumiko-changes
feature: dev-server
type: improvement
title: createKumikoServer handle exposes the boot's jobQueueNamePrefix
migration: |
  No action needed: purely additive handle field.
-->
