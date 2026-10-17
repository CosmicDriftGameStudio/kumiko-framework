---
"@cosmicdrift/kumiko-bundled-features": minor
---

personal-access-tokens: listScreen option for description and slots

<!-- kumiko-changes
feature: personal-access-tokens
type: improvement
title: The token list screen takes a description and slots via listScreen
detail: createPersonalAccessTokensFeature({ listScreen: { description, slots } }) sets the i18n description and the slots (for example a header component) of the api-tokens list, so an app can show instructions above the list and use the bundled screen directly instead of embedding it in its own dashboard. Without the option nothing changes. Both bundled token screens are now marked agent: { expose: false }, since the mint screen reveals the token plaintext.
-->
