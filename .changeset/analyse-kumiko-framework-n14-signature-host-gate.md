---
"@cosmicdrift/kumiko-bundled-features": minor
---

Signature requests are gated by a host row through `parentRef`; `authorizeSubject`, `unscopedRoles` and the sealed list cursor are removed.

<!-- kumiko-changes
feature: signature
type: breaking
title: Signature requests are visible through their host row
detail: `createSignatureFeature` takes the required `hostEntities`, and every `signature:write:request` payload carries `hostType` and `hostId`. A user sees, signs, issues links for, revokes and cancels a request only while the host row is readable to them through the host entity's own `access.read`; otherwise the answer is 404 like a missing record. The request list filters in SQL, so `total`, `offset` and `aggregate` work again and the cursor is a plain cursor. The signer list requires exactly one `requestId` filter for every user (403 otherwise) and answers an empty page for a request whose host the user cannot read. `authorizeSubject`, `unscopedRoles`, `AuthorizeSignatureSubject` and `SignatureSubject` are removed. `subjectType` and `subjectId` stay as a free label.
migration: Pass `hostEntities` (registered entity names without their own `parentRef`) and add `hostType`/`hostId` to every request payload; move the visibility rule from `authorizeSubject` into `access.read` of the host entity. Run `kumiko-schema generate` and ship the migration for the columns `host_type` and `host_id` and the index on `read_signature_requests`. Requests stored without a host stay invisible.
-->
