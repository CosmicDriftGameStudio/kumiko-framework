---
"@cosmicdrift/kumiko-bundled-features": patch
---

New bundled features `letter-foundation` and `letter-provider-inmemory` for sending PDFs as postal letters through a print provider.

<!-- kumiko-changes
feature: letter-foundation
type: improvement
title: `letter-foundation`: send PDFs as postal letters through a print provider, with approval, cap counting and a monthly cost limit per tenant
detail: New feature with the `letterProvider` extension point and `letter-provider-inmemory`. Letters are created with `sendLetter`, approved by a user with a dedicated right and handed to the provider by a job. Live sending needs an explicit env switch and only boots in production.
-->

<!-- kumiko-changes
feature: letter-provider-inmemory
type: improvement
title: `letter-provider-inmemory`: a letter provider for tests and demos that sends nothing
detail: Registers the `inmemory` provider for `letter-foundation`. It runs whenever the live switch is off, and tests steer it with `letterSimulator.setScenario` (accept, reject, timeout, on hold, other price or recognized address) and `setClock`.
-->
