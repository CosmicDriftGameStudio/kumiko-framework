---
"@cosmicdrift/kumiko-server-runtime": patch
---

composeFeatures no longer warns about auth-self-registration listed in APP_FEATURES

<!-- kumiko-changes
feature: server-runtime
type: fix
title: composeFeatures no longer warns about auth-self-registration listed in APP_FEATURES
-->

With `includeBundled` and `authOptions.signup`, `composeFeatures` still drops an `auth-self-registration` copy from `APP_FEATURES`, but no longer logs a boot warning for it. The toggle takes no options, so the copy is identical, and apps keep it in `APP_FEATURES` because the schema CLI and tests compose without `authOptions.signup`.
