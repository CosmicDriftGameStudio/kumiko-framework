---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

Review fixes: a failing trial gate hides the add-on in the app schema instead of failing the request, error docs links skip app-overridden error codes, anonymous sessions never bind pending uploads in the save pipeline, and failed uploads drop their ledger row.

<!-- kumiko-changes
feature: framework
type: fix
title: Failing trial gate no longer breaks GET /api/schema
detail: The trial gates of all disabled toggleable features run in parallel; a gate that throws counts as not unlocked, hides the add-on and is logged, so the client still boots.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: No docsUrl for app error codes without a framework page
detail: An app subclass that overrides the error code with an uncovered reason no longer links to a framework page that does not exist; the field is absent unless errorDocs covers the reason.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: Anonymous sessions cannot bind pending uploads on save
detail: The save pipeline now applies the same anonymous-session exclusion as the pending file ref helpers, so one visitor cannot attach another visitor's pending upload to their record.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: Failed uploads drop their upload ledger row
detail: When the fileRef create fails after the bytes were written, POST /files and createFileRefFromBytes now delete the bytes and forget the ledger row instead of leaving it for the next sweep.
-->
