---
"@cosmicdrift/kumiko-bundled-features": patch
---

The privacy center boot test declares a personal-data stance on its fixture fields, which entity text fields require since the stance became part of the field type.

<!-- kumiko-changes
feature: user-data-rights
type: fix
title: privacy center boot test fixture declares a field stance
detail: Test-only change. Two changes merged back to back on main: one added the privacy center deletion test with plain text fixture fields, the other made a personal-data stance mandatory on entity text fields. The fixture fields now state allowPlaintext, so the framework type check passes again.
-->
