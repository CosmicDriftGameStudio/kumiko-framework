---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

Handlers get `ctx.visitorKey`, a keyed pseudonym of the HTTP caller that changes every UTC day.

<!-- kumiko-changes
feature: framework
type: improvement
title: ctx.visitorKey for anonymous dedup and per-visitor limits
detail: During an HTTP request every handler context carries `visitorKey`, a hex HMAC-SHA256 over the UTC day, the resolved client IP and the User-Agent, keyed with a purpose key derived from the JWT signing secret. The same browser gets the same key in every handler and nested dispatch for one UTC day, and a new key after midnight UTC or after a signing-secret rotation. It is absent in jobs and event consumers and when the client IP resolves to "unknown", so callers behind a misconfigured proxy are never merged into one visitor. Use it to count an anonymous visit once per day or as the subject of a per-visitor limit without storing the IP, and keep it out of events. The type is `VisitorKey` from `@cosmicdrift/kumiko-types/identifiers`, also exported from `@cosmicdrift/kumiko-framework/engine`.
-->
