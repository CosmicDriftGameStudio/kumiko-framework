---
"@cosmicdrift/kumiko-bundled-features": patch
---

The Mollie plugin uses the `mollie-api-typescript` SDK, since `@mollie/api-client` is deprecated.

<!-- kumiko-changes
feature: subscription-mollie
type: fix
title: subscription-mollie moves to the maintained Mollie SDK
detail: The `@mollie/api-client` package is deprecated, so `subscription-mollie` now calls the Mollie API through `mollie-api-typescript`. The plugin options, exports and Mollie endpoints stay the same. A webhook whose payment lookup fails for any reason other than an unknown id (network, unexpected response) is now answered as a failure, so Mollie delivers it again instead of it being dropped with a 200.
-->
