---
"@cosmicdrift/kumiko-testing": minor
---

`GET /__test/inbox` and `mailCapture` now read tenantless mail (signup, forgot-password, magic-link) from an app's raw `createInMemoryTransport()` outbox, not just `mailTransportInMemoryFeature`'s per-tenant buffer.

`inboxQuerySchema`'s `tenantId` is now optional (`to` stays required). `createE2eSeedRoutes({ mailOutbox })` accepts `{ readonly sent: readonly EmailMessage[] }` — an app's raw transport passed through as-is. The route reads both sources when both are configured, filters each by `to` (case-insensitive), and returns the tenant buffer before the outbox, each **newest first**; two mails to the same address no longer come back oldest-first. With neither `mailTransportInMemoryFeature`+`tenantId` nor `mailOutbox` available, the route now names both ways to fix it in its 501.

`mailCapture(request, tenantId, to)` returning `Promise<CapturedMail[]>` is now `mailCapture(request, to, { tenantId?, match? })` returning `Promise<CapturedMail>` — the first mail in that order matching `to` (and `match`, if given), i.e. the newest one per source.

<!-- kumiko-changes
feature: testing
type: breaking
title: mailCapture and the /__test/inbox route read tenantless mail via a new mailOutbox option
detail: |
  Apps sending Dev/E2E mail through a raw createInMemoryTransport() (signup,
  forgot-password, magic-link — flows with no tenant) had no way to read it
  through the seed inbox route, which required tenantId and only checked
  mailTransportInMemoryFeature's per-tenant buffer. createE2eSeedRoutes()
  now accepts mailOutbox: { sent: readonly EmailMessage[] } (the raw
  transport's own array); inboxQuerySchema's tenantId is optional. The route
  reads whichever source(s) are configured, filters by to, and returns each
  source newest-first instead of oldest-first.
migration: |
  mailCapture(request, tenantId, to) -> mailCapture(request, to, { tenantId }),
  and it now resolves to a single CapturedMail (the newest match) instead of
  a readonly CapturedMail[]. Pass match: (mail) => boolean to pick a mail
  other than the newest at that address. Apps with their own ungated debug
  route for a raw transport (e.g. /_debug/mails.json) pass that transport as
  createE2eSeedRoutes({ mailOutbox: transport }) and delete the app-local
  route; tenantId becomes optional wherever only mailOutbox is used. Any
  direct reader of GET /__test/inbox must expect newest-first ordering.
-->
