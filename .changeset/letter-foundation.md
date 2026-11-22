---
"@cosmicdrift/kumiko-bundled-features": patch
---

New bundled features `letter-foundation` and `letter-provider-inmemory` for sending PDFs as postal letters through a print provider.

<!-- kumiko-changes
feature: letter-foundation
type: improvement
title: `letter-foundation`: send PDFs as postal letters through a print provider, with approval, cap counting and a monthly cost limit per tenant
detail: New feature with the `letterProvider` extension point and `letter-provider-inmemory`. Letters are created with `sendLetter`, approved by a user with the role `LetterApprover` and handed to the provider by a job. A letter names its shipping mode (`standard`, `einwurf`, `uebergabe`, `rueckschein`) and its envelope (`folded`, or `flat` for unfolded A4 in a C4 envelope); what a provider lacks is refused. A letter declared as `schriftform` is refused unless the app passes `formRiskAcknowledged: true`. The limit is the config key `monthlyCostLimitCents`, 0 until it is set. Live sending needs `LETTER_LIVE=true` and only boots in production. Production needs the variable set to `true` or `false`; without it letters are refused with `letter_provider_not_configured`. A handover that got no answer keeps its price booked until the poll job or a privileged user (`resolve-unknown`) settles it, and no letter is sent twice. An approved letter that cannot be handed over for two hours fails with `handover-stalled`. A letter stays with the provider it was approved with: after a provider change the poll leaves it alone, `cancel` and `resolve-unknown` with a `providerJobId` refuse it with `letter_provider_changed`, and an unsent letter fails with `provider-changed`. The data export of a user lists the letters the user created or approved, without the recipient. See `docs/guides/letters.md`.
-->

<!-- kumiko-changes
feature: letter-provider-inmemory
type: improvement
title: `letter-provider-inmemory`: a letter provider for tests and demos that sends nothing
detail: Registers the `inmemory` provider for `letter-foundation`. It runs whenever the live switch is off, and tests steer it with `letterSimulator.setScenario` (accept, reject, timeout, on hold, other price or recognized address) and `setClock`.
-->
