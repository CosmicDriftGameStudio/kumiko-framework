---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
---

Embedded-list footer totals can sum several columns under their own label

<!-- kumiko-changes
feature: renderer
type: improvement
title: Embedded-list footer totals can sum several columns under their own label
detail: EmbeddedFieldDef.totals entries are now a column name (as before) or { label, from } with an i18n label and the sub-fields to add up, for example Net { from: ["amount"] }, VAT { from: ["vatAmount"] } and Gross { from: ["amount", "vatAmount"] }. Display only, the server derivation is unchanged. The boot validator rejects an empty from and any from entry that is not a number, money or decimal sub-field. Money sums use the same format as string totals. The ui-walkthrough receive-invoice screen and the embedded recipe now lay out only the Positionen list with a footer of Net, VAT and Gross; the derived head totals are still computed on the server but not laid out, and the list requires at least one line (minItems 1).
migration: Optional. Replace a totals string list with labelled entries where the footer should show Net, VAT and Gross (solon invoice screens).
-->
