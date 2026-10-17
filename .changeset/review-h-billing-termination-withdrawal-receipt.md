---
"@cosmicdrift/kumiko-bundled-features": patch
---

Contract termination downgrades late withdrawals and caps receipt mails

<!-- kumiko-changes
feature: billing-foundation
type: fix
title: Contract termination downgrades late withdrawals and caps receipt mails
detail: A withdrawal declared after the 14-day period ends at period end (operator notice withdrawal_period_expired); the declaration is always accepted, receipt mails are capped at 3 per recipient per day and carry only enum fields, request id and time; purchaser roles come from the catalog.
-->
