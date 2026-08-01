---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-dev-server": patch
---

PR-review fix batch (deferred careful-tier findings):

- `document-ingest-foundation`'s `fileRef.created` MSP now appends a `documentIngest.skipped` event (with a `reason`) instead of silently dropping oversized/unsupported-mime uploads — the previous behavior gave neither the user nor ops any way to tell "not supported" from "ingest broken".
- `pii-retention` boot-validator: the `blockDelete`-without-`anonymize` warning now also fires for entities whose only subject binding is a `{ subjectRef: true }` FK (no annotated content) — it previously missed those entirely.
- `warnOnUniqueAccessRoles` now scans config-key and entity/field access rules too (not just handlers), and is opt-in via `validateBoot(features, { warnOnUniqueAccessRoles: true })` / `createApp({ validateBootOptions })` instead of always-on — a role scoped to exactly one endpoint on purpose is the normal shape of fine-grained access, not always a typo.
- `seedUser`/`seedUserWithPassword`/`seedAdmin` now reconcile `emailVerified: true` onto an already-seeded row (via a real `.updated` event) instead of only applying it on first insert — a persistent dev DB re-seeded with the flag previously stayed stuck unverified.
- Dev-server scaffold (`bin/dev.ts`) now seeds the admin with `emailVerified: true` so a fresh `bun dev` doesn't immediately hit the `422 email_not_verified` login gate; the prod scaffold (`bin/main.ts`) is unchanged on purpose.
- `EntityEditCreateBody`/`ActionFormBody` (renderer): a URL search-param no longer sets a value for a field the screen's layout doesn't render — it previously could inject an invisible, unvalidated value into a create-form submission.
- `ReferenceCreateDialog`: a create-handler success with no `id` in the payload (custom create variant) now still closes the dialog and refetches the reference list, with a visible banner explaining the record couldn't be auto-selected — it previously returned silently, leaving the dialog open with no feedback.
- Two `config`/`auth-mfa` KEK-rotation jobs' duplicated envelope-classification logic is now one shared `classifyStoredEnvelope` (`bundled-features/shared`).
- `jobs` feature's "is this job manually triggerable" check is now one shared predicate instead of two independently-maintained copies (`catalog.query.ts`, `trigger.write.ts`).
- `login-gates`/`document-ingest-foundation`/dev-server integration tests hardened against several fake-test / flaky-timing gaps found in review (exact payload assertions instead of `ok === false`, deterministic abort-timing instead of a race against a heartbeat timer, a single read-loop instead of a per-iteration `Promise.race` that could drop an SSE chunk).
