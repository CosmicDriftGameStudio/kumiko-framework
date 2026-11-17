---
"@cosmicdrift/kumiko-framework": patch
---

`storedEventPayloadSchema` derives the schema a projection apply parses for an event with personal fields.

<!-- kumiko-changes
feature: framework
type: improvement
title: storedEventPayloadSchema for projection applies
detail: `storedEventPayloadSchema(schema, piiFields)` from `@cosmicdrift/kumiko-framework/engine` takes an event's object schema and its `piiFields`. Every listed field becomes a plain string, because it reaches the apply as ciphertext, and keeps its optional and nullable stance; all other fields keep their write-side rules. A PII key the schema does not have is a type error. It replaces hand-copied, relaxed duplicates of event schemas.
-->
