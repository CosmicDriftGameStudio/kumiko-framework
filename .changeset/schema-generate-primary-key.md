---
"@cosmicdrift/kumiko-framework": patch
---

`kumiko-schema generate` now detects primary-key changes.

<!-- kumiko-changes
feature: framework
type: fix
title: Schema generator emits primary-key changes
detail: A changed primary key (single to composite, reordered columns, renamed constraint) previously produced no migration. The generator now emits DROP CONSTRAINT plus ADD CONSTRAINT with a WARN comment, and managed projections are recreated and replayed.
-->
