---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

JWT verification accepts only HS256, and a keyring accepts only tokens with a known kid.

<!-- kumiko-changes
feature: framework
type: breaking
title: JWT verify pins HS256 and requires a kid in keyring mode
detail: `createJwtHelper` and the unsubscribe tokens of `delivery` verify with `algorithms: ["HS256"]`, so a token signed with another HMAC algorithm and the same secret is rejected. With a keyring (`JWT_SECRET_V<n>` + `JWT_SECRET_CURRENT_VERSION`) a token without a `kid` or with an unknown `kid` is rejected; verification no longer tries every key. `loadJwtSecretOrKeyring` no longer carries a plain `JWT_SECRET` into the keyring as the `legacy` key, and runProdApp no longer logs the legacy warning. `JWT_SECRET` stays required for the HMAC token family.
migration: Switching an app from `JWT_SECRET` to the keyring logs every user out once, because their kid-less tokens are rejected. No app sets the keyring today, so nothing changes on update.
-->
