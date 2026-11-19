---
"@cosmicdrift/kumiko-bundled-features": patch
---

Ledger adds ensure-accounts, an idempotent write that creates missing chart-of-accounts entries by code and returns their ids.

<!-- kumiko-changes
feature: ledger
type: improvement
title: Idempotent ensure-accounts write
detail: ledger:write:ensure-accounts takes up to 50 accounts with code, name and type, locks per code, creates only the missing ones and returns a code-to-id map; an existing code with a different type fails with a conflict before anything is created.
migration: Replace app-side find-or-create loops over account:list and account:create with one ensure-accounts call.
-->
