---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
---

Shared type guards and fewer unchecked casts in framework internals

<!-- kumiko-changes
feature: framework
type: improvement
title: Shared type guards and fewer unchecked casts in framework internals
detail: "@cosmicdrift/kumiko-types/type-guards" exports isPlainObject, isOneOf and errorCodeOf. The framework replaces many unchecked as-casts with narrowing, generic query rows and table-introspection helpers. encryptPiiFieldValues is generic over the row and returns PiiEncryptedRow<TRow>, so callers read encrypted fields without casts. Behavior stays the same.
-->
