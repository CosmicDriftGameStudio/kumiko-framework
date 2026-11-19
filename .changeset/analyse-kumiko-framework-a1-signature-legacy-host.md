---
"@cosmicdrift/kumiko-bundled-features": patch
---

The signature feature takes an optional `legacyHostOf` that names the host of requests stored before the host gate existed.

<!-- kumiko-changes
feature: signature
type: improvement
title: legacyHostOf makes pre-host-gate signature requests visible again
detail: Signature requests created before `hostType` and `hostId` existed have no host in their created event, so the host gate hides them. The new optional `legacyHostOf({ subjectType, subjectId }, ctx)` option of `createSignatureFeature` returns the `{ hostType, hostId }` of such a request (it may look rows up through `ctx.db`); it runs as an upcaster when events are replayed, the stored events stay unchanged. A host outside `hostEntities`, an empty `hostId` or `undefined` leaves the request without a host and invisible. The request entity moves to eventVersion 2 with a no-op upcaster when the option is not set. The types `SignatureHost` and `SignatureLegacyHostResolver` are exported.
-->
