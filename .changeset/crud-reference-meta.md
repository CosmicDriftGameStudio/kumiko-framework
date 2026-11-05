---
"@cosmicdrift/kumiko-framework": patch
---

Schemas built from an entity name the entity behind each reference field.

<!-- kumiko-changes
feature: framework
type: fix
title: CRUD schemas carry the reference target of their fields
detail: `createReferenceField` built a bare `z.uuid()`, so `handlerFieldReference` found nothing on `r.crud` write handlers. Insert and update schemas now set the same `references` meta a hand-written handler schema uses, which lets an agent proposal name the referenced record instead of showing its id.
-->
