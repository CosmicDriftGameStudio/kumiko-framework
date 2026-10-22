---
"@cosmicdrift/kumiko-server-runtime": patch
---

The default CSP now also carries the hashes of inline scripts in HTML that the app writes into `staticDir` at boot, not only the ones listed in `csp-hashes.json`. Before, pages rendered after `kumiko build` (for example apex landing pages with the lightbox script) were served with a CSP that blocked their inline script. `staticDir` is server-owned, so no hash ever comes from request data.

<!-- kumiko-changes
feature: server-runtime
type: fix
title: Default CSP covers inline scripts of HTML written after the build
detail: At boot the hashes from csp-hashes.json are merged with the inline scripts found in the HTML files under staticDir, for the default CSP and for hostDispatch. Boot-rendered pages keep their inline scripts working without a custom securityHeaders.csp.
-->
