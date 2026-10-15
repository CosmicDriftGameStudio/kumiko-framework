---
"@cosmicdrift/kumiko-server-runtime": minor
---

composeFeatures mounts the mail stack that auth-email-password needs

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: composeFeatures adds template-resolver, renderer-foundation and renderer-mail-html for auth apps
detail: With includeBundled, the auth mails are stored templates and the boot seed needs the template-resolver and a mail renderer. composeFeatures adds whichever of template-resolver, renderer-foundation and renderer-mail-html the app does not mount itself, so runDevApp, runProdApp and scaffolds keep booting. Apps without the template tables need a schema migration (`kumiko schema generate`).
-->
