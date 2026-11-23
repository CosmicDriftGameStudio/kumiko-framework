---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

`letter-foundation` prepares every letter right after it is created, can approve letters automatically and approves a selection in one step.

<!-- kumiko-changes
feature: letter-foundation
type: improvement
title: A letter is prepared when it is created; `approval: "auto"` and `approve-many`
detail: `sendLetter` now announces a `created` event and the job `prepare` merges the PDF, counts pages and sheets and quotes the price, so `preview` and `approve` read stored values. A document problem is kept in `preparationIssue` and the letter keeps waiting; the poll prepares again a letter the job missed for 15 minutes. `sendLetter(ctx, input, { approval: "auto" })` (field `approvalMode`; the option is not part of `SendLetterInput`, so a client payload cannot request it) lets the job approve a prepared letter within the monthly limit. The write handler `approve-many` (role `LetterApprover`) approves a selection all or none and fails with `letter_not_ready_for_approval` otherwise; the query `budget` returns `limitCents` and `usedCents`; `quoteLetter(ctx, spec)` prices a document before it exists as a letter. `preview` additionally returns `mergedFileRefId` and `preparationIssue`. `SendLetterContext` now needs `dispatch`, which every handler context has. The monthly limit appears on the generated settings screen.
-->
