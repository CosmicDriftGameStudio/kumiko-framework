---
"@cosmicdrift/kumiko-framework": minor
---

A translation that holds only whitespace now counts as missing, the same as an empty string. The same applies to each form of a plural.

<!-- kumiko-changes
feature: framework
type: breaking
title: Whitespace-only translations and blank plural forms fail the boot check
detail: The locale completeness check at boot treated a value of one space as present, so a button with that label rendered blank, and it treated every plural object as present. Whitespace-only strings and plurals with an empty or whitespace-only form now count as missing, and the i18n parity test applies the same rule to locale bundles.
migration: Fill in each key the boot error lists. For a plural, fill in the blank form or remove it so the lookup falls back to `other`.
-->
