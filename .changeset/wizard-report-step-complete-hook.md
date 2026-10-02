---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-guards": patch
---

New framework hook `useReportStepComplete(reportStepComplete, complete)` in `@cosmicdrift/kumiko-renderer`. Extension wizard steps report whether they hold their data without a raw `useEffect`, which the no-raw-hooks guard rejects in app screens. With `complete === null` (data still loading) it reports nothing; otherwise it reports on every change. The no-raw-hooks guard hint names the hook.

<!-- kumiko-changes
feature: renderer
type: improvement
title: useReportStepComplete reports an extension wizard step's completeness without a raw useEffect
detail: |
  `useReportStepComplete(props.reportStepComplete, complete)` with `complete: boolean | null`. `null` reports nothing (data loading), a boolean is reported whenever it changes. Outside update-mode wizards `reportStepComplete` is undefined and the hook does nothing.
migration: |
  Extension steps that call `reportStepComplete` from a `useEffect` should switch to `useReportStepComplete(reportStepComplete, complete)`; app repos need this to pass the no-raw-hooks guard.
-->
