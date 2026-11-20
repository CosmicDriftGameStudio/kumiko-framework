---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": patch
---

A job can react to a file a satellite delivered and read it, and the app schema no longer warns about `table: { export: undefined }`.

<!-- kumiko-changes
feature: connectors
type: improvement
title: Job trigger and reader for delivered files
detail: `connectors` exports `INBOUND_ITEM_CREATED_EVENT` (`inbound-item.created`) for `r.job({ trigger: { on } })` and `readInboundFile(ctx, inboundItemId, { maxBytes })`, usable in a job and a write handler. It returns the decrypted `relativePath`, `connectorId`, `connectorName`, `sha256`, `sourceModifiedAt` and the bytes, or `{ isSuccess: false, failure: "not-found" | "too-large" }` without throwing. `buildAppSchema` drops an explicit `table.export: undefined` from entityList and projectionList screens, so mounting `connectors` no longer logs "output is not JSON-safe".
-->
