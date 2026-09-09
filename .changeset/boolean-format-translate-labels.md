---
"@cosmicdrift/kumiko-headless": patch
---

Fixes `applyFormatSpec` ignoring its `translate` callback for `format: "boolean"`. A declared `trueLabel`/`falseLabel` was returned verbatim, so a column that declares an i18n key as its label rendered the raw key text — visible in the managed-pages page list, whose `published` column declares `managed-pages:entity:page:field:published:option:true|false`. Both labels now go through `translate` when one is supplied, exactly like the `enumOption` branch. Plain-text labels are unaffected (a pass-through `translate` returns them unchanged), and the `✓` / empty defaults for an undeclared label stay untranslated.
