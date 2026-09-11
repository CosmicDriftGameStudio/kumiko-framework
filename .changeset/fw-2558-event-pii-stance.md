---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

fw#2558: **BREAKING** — `r.defineEvent(name, schema, options)` now requires an explicit PII stance. The third argument is mandatory and must carry `piiFields`, typed `EventPiiStance = EventPiiFields | "none"`.

Before this change, omitting `piiFields` silently opted the event out of the crypto-shredding catalog, so `append()` wrote the payload to `kumiko_events` in plaintext with no signal that a decision had ever been made. Omission and "this payload holds no personal data" were indistinguishable. Now the registrar throws at registration time, and `publishEventPiiCatalog` re-checks every registered event at boot as defense in depth.

Migration — every `r.defineEvent(...)` call site needs one of:

```ts
// payload holds no personal data
r.defineEvent("invoice-paid", schema, { piiFields: "none" });

// payload holds personal data, encrypted under the owning user's DEK
r.defineEvent("attempt", schema, {
  piiFields: { recipientAddress: { subjectField: "recipientId" } },
});
```

`piiFields: {}` is rejected — an empty object is indistinguishable from "the author forgot to list fields", so `"none"` is the only way to declare a payload PII-free. A `subjectField` names the payload field holding the owning user's id; it is a pseudonymous reference, not itself a catalogued PII field.

Existing stored events are untouched: no backfill runs, and every bundled-features event that previously had no stance now declares `"none"`, which keeps `encryptEventPayloadPii` on exactly the path it took before. The one bundled event that already declared a stance (`delivery/attempt`) is unchanged.

The feature-AST round-trip carries the stance too: `DefineEventPattern.piiFields` is required, the extractor fails on a `defineEvent` without one rather than inventing a default, and the renderer always emits the options block. Designer-regenerated feature files therefore keep the author's stance verbatim instead of silently downgrading it to plaintext.

Forcing the stance surfaced five bundled events whose payload can carry plaintext personal data but which the current `EventPiiStance` cannot express — an `unknown`-typed custom-field value, operator free-text on the crypto-shredding audit events, a mail-account `displayName`, an ingest `fileName`. They ship as `"none"` with an in-code note pointing at the follow-up (#2776); their behaviour is unchanged from before this release, when they carried no stance at all.
