---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
---

Shared type guards and fewer unchecked casts in framework internals

<!-- kumiko-changes
feature: framework
type: improvement
title: Shared type guards and fewer unchecked casts in framework internals
detail: "@cosmicdrift/kumiko-types/type-guards" exports isPlainObject, isOneOf and errorCodeOf. The framework replaces many unchecked as-casts with narrowing, generic query rows and table-introspection helpers. Behavior stays the same.
-->
