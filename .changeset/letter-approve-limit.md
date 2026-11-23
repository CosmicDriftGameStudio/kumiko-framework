---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-guards": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

`letter-foundation`: approval checks the monthly limit, and duplex letters start every file on a new sheet.

<!-- kumiko-changes
feature: letter-foundation
type: improvement
title: `letter-foundation`: `approve` refuses a letter the monthly limit does not cover; every file of a duplex letter starts on a new sheet
detail: `approve` fails with `letter_monthly_limit_not_covered` when the limit minus the month's usage and the price of all approved, not yet handed-over letters is smaller than the price of the letter; the letter stays in `awaiting-approval`. The preview counts the same way. The reservation at handover stays the binding check. `cancelLetterBeforeHandover(ctx, letterId)` cancels a waiting or approved letter without the `LetterApprover` role check. In duplex, a blank page follows a file with an odd page count, so the next file begins on a new sheet; sheets and price come from the merged document.
-->

<!-- kumiko-changes
feature: guards
type: fix
title: The Direct-Entity-Writes guard finds tables that are destructured from `createEntityExecutor`
detail: `export const { executor, table: fooTable } = createEntityExecutor(entity)` now counts as an event-sourced table, in the guard and in the `kumiko-es-tables.json` catalog of a package. Before, such tables (for example `letterTable`, `signatureRequestTable`) were missing from the catalog, so a consumer's direct write on them went unnoticed.
-->
