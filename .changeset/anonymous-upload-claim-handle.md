---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-renderer": minor
---

Anonymous uploads are bound to a record only with the claim handle the upload returned.

<!-- kumiko-changes
feature: files
type: breaking
title: Anonymous file uploads need the claim handle to be bound
detail: All anonymous visitors share one session user id, so "uploaded by me" proved nothing and any visitor could attach another visitor's pending upload to a record, or read and delete it. An anonymous `POST /files` now returns `handle` (`<fileRefId>.<claim>`, claim is 32 random bytes in base64url) next to `id`; only the sha256 of the claim is stored in the new nullable `file_refs.claim_hash` column. File and image fields accept a UUID or a handle, the executor resolves handles on create and update with a constant-time claim check (also for system users) and persists only the bare UUID. The save pipeline now rejects with `invalid_element` every pending file ref that the writer neither uploaded as a non-anonymous user nor proved by claim. Anonymous `GET /files/:id`, the meta routes and `DELETE` answer 404 before any app access guard runs. `SaveContext` gains the optional `claimedFileRefIds`; the renderer upload widget lifts the handle instead of the id when the server returns one.
migration: |
  Clients that upload anonymously must submit `handle` from the POST response (not `id`) in the file or image field; a `writeAs` that passes a bare id of an anonymous upload now fails with `invalid_element`. Anonymous uploads from before the upgrade have no claim, can no longer be bound and are removed by the existing sweep of unbound uploads. Anonymous GET, meta and DELETE of files are blocked. Apply the generated migration that adds `file_refs.claim_hash`.
-->
