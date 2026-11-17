---
"@cosmicdrift/kumiko-bundled-features": minor
---

Ledger reports read only the posted entries of the requested period from the database instead of the tenant's whole journal.

<!-- kumiko-changes
feature: ledger
type: breaking
title: Ledger reports filter the period in SQL and require ISO dates
detail: `report:balances`, `report:income-statement` and `report:balance-sheet` now pass `from`/`to` and the posted status to the database query, so a report reads only the entries it sums. Both bounds stay inclusive. `from` and `to` must be calendar dates in the form `YYYY-MM-DD`; other strings fail validation instead of being compared as text.
migration: Callers that pass `from` or `to` send `YYYY-MM-DD` dates.
affects: reportBalances, reportIncomeStatement, reportBalanceSheet, report:balances, report:income-statement, report:balance-sheet
-->
