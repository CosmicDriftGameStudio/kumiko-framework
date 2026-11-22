---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer": patch
---

actionForm `redirect.onlyWith` makes the redirect depend on a result field and falls back to the success box.

<!-- kumiko-changes
feature: renderer
type: improvement
title: actionForm redirect can depend on a result field and fall back to the success box
detail: `redirect.onlyWith` names a flat field of the success payload. The form navigates only when that field is a non-empty string; otherwise it stays put and shows its `successMessage`, `successFacts`, `successItems` and `successLinks`, which boot now accepts next to a redirect that sets `onlyWith`.
-->
