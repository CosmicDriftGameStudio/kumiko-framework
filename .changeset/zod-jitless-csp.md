---
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-dev-server": patch
---

Client bundles set zod to `jitless` before any code runs. zod tested `new Function` once to choose its parser, and under the default `script-src 'self'` CSP Chrome reported that test as a blocked `eval` in the DevTools issues panel. The parser zod uses is unchanged, because the CSP already blocked its JIT path.

<!-- kumiko-changes
feature: server-runtime
type: fix
title: No more CSP eval warning in the browser
detail: The web client no longer triggers the DevTools message "Content Security Policy of your site blocks the use of 'eval' in JavaScript". Nothing to change in the app; rebuild with this version.
-->
