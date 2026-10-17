---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

coerceRow takes a raw driver row and returns the caller's row type

<!-- kumiko-changes
feature: framework
type: fix
title: coerceRow no longer claims the raw driver row already has the converted shape
detail: coerceRow now accepts a Record<string, unknown> driver row and returns the explicitly requested row type, with the single cast at that boundary. The raw event-consumer, pending-event and projection-rebuild queries return untyped rows instead of a caller-chosen generic. The eventMigrations JSDoc and the expand/contract guide now state that pii and encrypted fields reach transforms as field-bound ciphertext and must not be renamed or derived from.
-->
