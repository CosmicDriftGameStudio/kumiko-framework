---
"@cosmicdrift/kumiko-framework": patch
---

`parseCsv` and `formatCsv` from `@cosmicdrift/kumiko-framework/utils` read and write RFC 4180 CSV.

<!-- kumiko-changes
feature: framework
type: improvement
title: CSV codec in utils
detail: `parseCsv(text, { delimiter })` strips a byte order mark, keeps line breaks inside quoted cells, skips blank records, reports the start line of each record and flags an unterminated quote. Cells are returned verbatim. `formatCsv(rows, { delimiter })` quotes cells with the delimiter, quotes or line breaks, ends lines with CRLF, and prefixes `'` to a cell that starts with =, +, -, @, tab or CR unless it is a plain number, so a spreadsheet does not run it as a formula. Apps replace their own CSV splitters with it.
-->
