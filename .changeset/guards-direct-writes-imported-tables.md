---
"@cosmicdrift/kumiko-guards": patch
---

Direct-entity-writes guard now follows imports, renames and barrel re-exports, so direct writes on event-store tables defined elsewhere in the scanned repo are reported. Tables defined only in node_modules (framework, bundled features) are still not collected. Consumers may see new findings.

<!-- kumiko-changes
feature: guards
type: fix
title: Direct-entity-writes guard catches imported event-store tables
detail: Table identifiers are resolved through import aliases to their definition, so direct insert/update/delete on an event-store table imported from another file of the scanned repo is no longer missed. Findings now show the full receiver (ctx.db). Existing consumers can get new findings that were previously hidden.
-->
