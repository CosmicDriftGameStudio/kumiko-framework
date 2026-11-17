---
"@cosmicdrift/kumiko-framework": patch
---

An optional single reference field reads an empty string as null on create and update.

<!-- kumiko-changes
feature: schema-builder
type: improvement
title: Optional references accept an empty string as unset
detail: Insert and update schemas map `""` to `null` for a non-required, non-multiple reference field, as they already do for an optional select. An untouched reference picker no longer fails UUID validation, and an update can clear the reference with `""`. Required and multiple references are unchanged.
affects: framework
-->
