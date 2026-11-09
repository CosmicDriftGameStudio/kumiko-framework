---
"@cosmicdrift/kumiko-framework": patch
---

A navigate action whose `screen` is a cross-feature QN now counts for the target form's URL prefill.

<!-- kumiko-changes
feature: framework
type: fix
title: URL prefill and the hidden-required boot rule follow navigate targets given as a QN
detail: `urlPrefillFields` and the boot rule `submit-prefilled-hidden-required` resolved a navigate `screen` only by its short id, so a target written as `<feature>:screen:<id>` was skipped silently. Its `params` keys now prefill the target form and seed its hidden required fields like a short-id target does.
-->
