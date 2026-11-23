---
"@cosmicdrift/kumiko-bundled-features": patch
---

pdf-lib is pinned to the exact version the PDF limits are verified against.

<!-- kumiko-changes
feature: signature
type: fix
title: pdf-lib is pinned to 1.17.1, the version the PDF limits are tested with
detail: The PDF limits of signature and letter-foundation wrap internals of pdf-lib. The dependency was a range (^1.17.1), so an app could install a newer pdf-lib that the limits were never tested against. It is now the exact version 1.17.1, and a test fails when the pin and the installed version differ.
-->
