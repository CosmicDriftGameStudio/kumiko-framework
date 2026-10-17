---
"@cosmicdrift/kumiko-framework": patch
---

ZIP entry listing ignores fake end-of-central-directory records in the comment

<!-- kumiko-changes
feature: framework
type: fix
title: The ZIP plausibility check picks the end record whose comment length reaches the end of the file
detail: The scan took the last end-of-central-directory signature, so a signature inside the archive comment could point the check at forged entry names. A candidate now only counts when its offset plus 22 bytes plus its comment length equals the file length. A docx upload with bytes appended after the end record is therefore rejected as content_mismatch.
-->
