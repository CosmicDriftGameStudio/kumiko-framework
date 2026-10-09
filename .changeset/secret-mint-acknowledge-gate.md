---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-headless": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

secretMint `reveal.acknowledge` (i18n key) renders a checkbox on the reveal card that must be ticked before the confirm step or the acknowledge button can be used; the tick never reaches the payload. Text fields accept an `autoComplete` token that reaches the input. The MFA enable screen uses both: a "saved my recovery codes" gate and `one-time-code` on the code field

<!-- kumiko-changes
feature: auth-mfa
type: improvement
title: MFA enable asks to confirm saved recovery codes, code field autocompletes one-time codes
-->
