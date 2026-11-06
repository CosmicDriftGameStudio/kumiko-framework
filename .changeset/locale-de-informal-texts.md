---
"@cosmicdrift/kumiko-locale-de": patch
---

The informal German bundle no longer contains formal texts. Fourteen strings still addressed the user with „Sie“; they now say „du“, and their old wording is in the formal overrides, so apps with `address: "formal"` read the same as before. The test against formal address now covers the whole bundle.

<!-- kumiko-changes
feature: locale-de
type: fix
title: Informal German bundle says du throughout
detail: Fourteen strings in the informal bundle addressed the user with Sie. They now say du. Apps with address formal keep the previous wording through the formal overrides.
-->
