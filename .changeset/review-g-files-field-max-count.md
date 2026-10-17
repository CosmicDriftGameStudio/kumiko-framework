---
"@cosmicdrift/kumiko-framework": patch
---

files and images fields enforce maxCount in the write schema

<!-- kumiko-changes
feature: framework
type: fix
title: files/images maxCount is validated on write
detail: The generated write schema applies .max(maxCount) to files and images fields, so payloads with more ids than allowed are rejected with a validation error.
-->
