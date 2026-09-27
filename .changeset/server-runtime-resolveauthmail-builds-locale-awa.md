---
"@cosmicdrift/kumiko-server-runtime": patch
---

resolveAuthMail builds locale-aware appUrls and adds a dedicated auth.mail.hmacSecret

resolveAuthMail (shared by runProdApp and runDevApp) now builds the passwordReset/emailVerification/signup/invite appUrl from a locale-aware AuthPath, so a function-valued auth.mail.paths entry produces a locale-aware appUrl for every flow, symmetric to the appUrl-as-function support each flow's options already had.

AuthMailOptions also gains an optional hmacSecret: when set, passwordReset/emailVerification tokens sign with it instead of the hmacSecret resolveAuthMail is called with (JWT_SECRET), so JWT_SECRET can rotate without invalidating in-flight reset/verify tokens. hmacSecret is now optional on the passwordReset/emailVerification wrapper options too — an app overriding just appUrl no longer has to also thread its own secret; resolveAuthMail backfills the resolved secret onto that explicit block. An explicitly supplied hmacSecret still wins.

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: resolveAuthMail builds locale-aware appUrls and adds a dedicated auth.mail.hmacSecret
-->
