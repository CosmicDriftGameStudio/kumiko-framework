---
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-dev-server": patch
---

runProdApp and runDevApp pass retiredCookieDomains through

`auth.retiredCookieDomains` is now accepted by both runners and reaches the auth routes. Before, the option existed only on the lower-level route config, so apps starting through the runners could not clear a retired cookie domain.

<!-- kumiko-changes
feature: auth
type: fix
title: runProdApp and runDevApp forward auth.retiredCookieDomains to the auth routes
-->
