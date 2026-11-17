---
"@cosmicdrift/kumiko-bundled-features": patch
---

Ledger adds report:subject-totals and schedule-actuals queries for per-contract saldo and forecast-versus-actual in one call.

<!-- kumiko-changes
feature: ledger
type: improvement
title: Subject totals and schedule actuals queries
detail: ledger:query:report:subject-totals returns net signed totals per subject, account and optionally period for up to 500 subjects of one subjectType, with optional account, period range and asOf filters. ledger:query:schedule-actuals returns posted entries including Stornos for up to 500 schedules, shaped for mergeScheduleActuals.
migration: Replace loops that page ledger:query:transaction:list per contract or schedule with one call to these queries.
-->
