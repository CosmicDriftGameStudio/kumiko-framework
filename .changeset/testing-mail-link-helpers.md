---
"@cosmicdrift/kumiko-testing": patch
---

E2e helpers read links and tokens out of captured mails

<!-- kumiko-changes
feature: testing
type: improvement
title: extractMailLink and extractMailLinkToken in kumiko-testing/e2e
detail: mailLinks, extractMailLink(mail, fragment) and extractMailLinkToken(mail, fragment, param) read href values from a captured HTML mail and decode HTML entities such as &#x3D; and &amp; once, so e2e specs no longer need their own mail helper.
-->
