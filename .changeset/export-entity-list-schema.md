---
"@cosmicdrift/kumiko-framework": patch
---

`listSchema` in `engine/entity-handlers.ts` war nicht exportiert, sodass Consumer wie money-horse die Query-Schema-Shape der Entity-List-Handler kopieren mussten (`mieten-list.query.ts`). Diese Kopien drifteten still vom Framework-Kontrakt ab, sobald ein Feld ergänzt wurde (money-horse#293). Fix: als `entityListSchema` aus `@cosmicdrift/kumiko-framework/engine` exportiert, damit Consumer importieren statt duplizieren.
