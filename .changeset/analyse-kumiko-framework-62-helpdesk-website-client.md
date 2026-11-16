---
"@cosmicdrift/kumiko-bundled-features": patch
---

`helpdeskWebsiteClient()` from `helpdesk/client` returns the checked `window.KumikoHelpdesk` client, so websites no longer write their own guard.

<!-- kumiko-changes
feature: helpdesk
type: improvement
title: helpdeskWebsiteClient gives websites a checked helpdesk client
detail: `helpdeskWebsiteClient(scope = globalThis)` from `@cosmicdrift/kumiko-bundled-features/helpdesk/client` reads `KumikoHelpdesk`, returns undefined while the script is missing and otherwise a typed `HelpdeskWebsiteClient`. `load()` resolves to valid form options (an unknown phone mode becomes `off`, unknown kinds are dropped and an empty list offers every website kind), `submit()` resolves to a `HelpdeskWebsiteSubmitResult` and turns a rejection or an unknown answer into `failed`. `HELPDESK_WEBSITE_SUBMIT_OUTCOME` names the three outcomes, and `HELPDESK_PHONE_MODES` from `helpdesk/web` lists the phone modes. Websites can delete their own `isHelpdeskClient`, outcome mapping and form-option parsing.
-->
