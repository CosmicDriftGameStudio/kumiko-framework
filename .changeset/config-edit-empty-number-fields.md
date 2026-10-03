---
"@cosmicdrift/kumiko-renderer": patch
---

configEdit number and money fields without a default now start empty instead of showing 0, so saving no longer writes an unintended 0. Clearing a stored number or money value resets this scope's override.

<!-- kumiko-changes
feature: renderer
type: fix
title: configEdit number and money fields start empty without a default
detail: |
  Number and money fields without a default no longer show 0, so saving does not write an unintended 0. Clearing a stored value resets this scope's override instead of sending an empty number.
-->
