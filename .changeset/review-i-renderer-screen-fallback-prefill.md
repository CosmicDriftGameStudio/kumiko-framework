---
"@cosmicdrift/kumiko-renderer": patch
---

Screen fallback access, projectionDetail back navigation and stricter prefill

<!-- kumiko-changes
feature: renderer
type: fix
title: Screen fallback access, projectionDetail back navigation and stricter prefill
detail: A visibleWhen fallback screen the user may not access now shows the standard unavailable notice instead of a "Screen not found" error. The not-found state of a projectionDetail honours returnTo for its back button. Embedded-list prefill rejects calendar-invalid dates, timestamps with numeric offsets and decimals beyond the safe range, and an empty number param keeps the field default instead of becoming 0.
-->
