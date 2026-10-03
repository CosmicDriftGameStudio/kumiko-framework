---
"@cosmicdrift/kumiko-framework": minor
---

fetchForWriting handles reject appends after a concurrent write

<!-- kumiko-changes
feature: framework
type: breaking
title: fetchForWriting handles reject appends after a concurrent write
migration: |
  Appends through a ctx.fetchForWriting handle now use the version the handle was read at. When two requests write the same aggregate concurrently, the later append no longer stacks on top silently: the request fails with 409 version_conflict (no automatic retry), and its transaction rolls back. Tests that fire concurrent writes on one aggregate and expected both to succeed must expect exactly one success. Clients should treat 409 version_conflict like a stale form: reload and retry.
-->
