---
"@cosmicdrift/kumiko-bundled-features": minor
---

The per-field `retention` option of custom fields is removed because its sweep never ran.

<!-- kumiko-changes
feature: custom-fields
type: breaking
title: Per-field custom-field retention removed
detail: `serializedField.retention` was accepted but the sweep behind it was never registered, so no value ever expired. The sweep and its tenant-unscoped update query are deleted, and define/update now reject a `serializedField` with a `retention` key.
migration: Drop `retention` from custom-field definitions. Use data-retention on the host entity for expiry.
-->
