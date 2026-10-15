---
"@cosmicdrift/kumiko-dev-server": minor
---

composeRendererStack mounts renderer-mail-html

<!-- kumiko-changes
feature: dev-server
type: improvement
title: composeRendererStack includes renderer-mail-html
detail: The renderer stack now also mounts createRendererMailHtmlFeature, which the auth mails need. Apps that already list renderer-mail-html next to composeRendererStack() drop their own copy, createRegistry rejects duplicate features.
-->
