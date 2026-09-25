---
"@cosmicdrift/kumiko-bundled-features": patch
---

data-retention hardDelete now erases a purged row's own KMS subject key

<!-- kumiko-changes
feature: data-retention
type: fix
title: data-retention hardDelete now erases a purged row's own KMS subject key
detail: |
  Refs #2057 (partial fix — the hardDelete path only). run-retention-
  cleanup's hardDelete forgot the row's event history via the executor but
  never crypto-shredded its KMS subject key, leaving the DEK live after the
  row was gone. It now erases the key in the same per-row sub-transaction as the
  forget (an eraseKey throw rolls the forget back too), mirroring run-
  forget-cleanup.ts's forget -> eraseKey -> nullBlindIndexesForSubject
  ordering. Only the row's own recordOwned/self-pii subjects are erased;
  a userOwned or tenantOwned field's subject is the REFERENCED user/tenant,
  not this row, and may still protect other live rows elsewhere — those
  keys are never touched. No migration needed.
-->
