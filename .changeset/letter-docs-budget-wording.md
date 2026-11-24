---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-samples": patch
---

`letter-foundation` README and recipe call the monthly limit a budget and say where it is set.

<!-- kumiko-changes
feature: letter-foundation
type: fix
title: Letter docs name the monthly budget and where to set it
detail: The feature README and the letter-foundation recipe say "monthly budget" like the settings mask. The README names both places (Settings › Platform › Letters for the default, Settings › Tenant › Letters for one tenant), and the recipe says that a budget of 0 makes `approve` refuse the letter; only a budget lowered after approval fails the handover with `monthly-limit`.
-->
