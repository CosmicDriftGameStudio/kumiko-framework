---
"@cosmicdrift/kumiko-renderer-web": patch
---

DataTableCell now threads the app locale (LocaleProvider) into format:"unit"/number/decimal/bigInt/money/date cell rendering instead of falling back to the runtime's default locale — list and detail views agree again for the same value.
