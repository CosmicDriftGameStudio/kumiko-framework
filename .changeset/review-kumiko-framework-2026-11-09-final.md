---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": patch
---

Review fixes (final round), signature list page-cap test.

<!-- kumiko-changes
feature: signature
type: fix
title: List cursor of subject-scoped users is sealed
detail: The request list returned the plain cursor of the last base page, which could name a request of a foreign subject. Scoped users now get an encrypted cursor bound to their user and tenant, a plain or foreign cursor is answered with access denied, and `authorizeSubject` now requires a non-empty `linkSecret` because the cursor key is derived from it. A scoped user asking for `limit: 0` is refused like `offset`.
-->

<!-- kumiko-changes
feature: signature
type: fix
title: Unrecoverable finalisation ends in status failed
detail: A request whose original PDF changed or went missing, or whose signature image is missing, used to stay `all-signed` forever while the sweep warned every five minutes. It now ends in the status `failed` with the event `signature:event:failed` and a reason (`document-changed` or `signature-image-missing`). Renderer outages and storage errors still retry on the next run.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: Boot validator checks dateOnlyAfterDays on list columns
detail: A column's `dateOnlyAfterDays` must be a non-negative whole number on every list kind. On an entityList column it requires a timestamp, locatedTimestamp or date field or a `relativeTime` format; on a projectionList or relatedList column a numeric `valueType` (number, decimal, bigInt, money) is rejected, and a relatedList column with an entity is checked against that entity's field type. Number columns that showed 42 as 1 January 1970 now fail at boot (rules `list/date-only-after-days-invalid` and `list/date-only-after-days-wrong-type`).
-->

<!-- kumiko-changes
feature: cap-counter
type: fix
title: withStockCap keeps the handler type
detail: `withStockCap` is generic over the write handler definition and returns the type it received, so a `defineWriteHandler` result passes in without an `as unknown as WriteHandlerDef` cast. Callers passing a `WriteHandlerDef` compile unchanged.
-->

<!-- kumiko-changes
feature: agent-tools
type: fix
title: API docs label nullable types
detail: A JSON Schema type array such as `["string", "null"]` (Zod nullable) was labelled `any` in the generated API docs. Each element is now labelled (string keeps its format) and joined with ` | `, with null last, e.g. `string | null`.
-->
