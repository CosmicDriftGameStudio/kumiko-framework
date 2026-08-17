---
"@cosmicdrift/kumiko-headless": patch
"@cosmicdrift/kumiko-renderer-web": patch
"@cosmicdrift/kumiko-types": patch
---

DataTable list columns of type `number`/`decimal`/`bigInt` now render locale-formatted via `Intl.NumberFormat`, matching how `timestamp`/`date`/`money` cells already behave. Previously they fell through to a raw `String(value)`, showing e.g. `245.5` with a dot even on a German-locale app while every other numeric column type used the locale's separator.
