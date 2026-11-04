---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

Board gaps round 6: dashboard heads, strips and rows, list headers, filters and pagination, record file details.

<!-- kumiko-changes
feature: renderer
type: improvement
title: board gaps round 6, dashboard rows, list headers, filters and pagination
detail: Dashboard panel heads put title and description on one line from sm. A titled stat strip bundles its boxes on the left (12px gap) with the link at the right; below sm the numbers are bold in text color. Dashboard list rows from sm: a leading badge column sits inline before the title, the meta line below, 12px row padding. New list options: `rowLink: { screenField, paramsField?, icon? }` (target screen from a query field; `screen` and `screenField` exclude each other, so `DashboardListRowLink.screen` is now optional when read; no app in the workspace reads it), `DashboardListPanel.icon` (extension component for the phone line), `narrow.moreText` (`{count}`), `narrow.titleField` (card title below sm), `rowToneMarker: "bar" | "dot"`, `narrow.field` may be any query output field (not only a column) and `footerLink.narrowOnly` (no footer link from sm, but the target of the phone line). New boot rules for these fields (`footerLink.narrowOnly` needs `narrow.layout: "line"`; a query without `outputSchema` falls back to the panel columns for `narrow.*`, `rowLink.screenField` and `paramsField`; `dashboard/list-narrow-field-unknown` now checks the query output; `query/output-field-missing` covers `rowLink.screenField`, `paramsField`, `narrow.titleField`). The dashboard header date follows the app clock of the server answer. Tables: column headers in small caps from sm; a `linkScreenField` or `display: "button"` action column is right-aligned with a screen-reader-only header from sm; a `linkScreenField` column stays a text link in the table, on cards it draws as a small outline button. Select filters read "<label>: All" when empty (i18n `kumiko.list.filter.all`); below sm (not below md) select-only filters are wrapping chips under the search and the filter icon button is dropped; the card sort line below sm reads "Sorted by <option> ↓ · <n> <noun>" (i18n `kumiko.list.sort.summary`, the count in the locale's number format). Pagination from sm: "1–10 of 26 · 10 per page" left, "‹ 1 2 3 ›" with the current page marked right (i18n `kumiko.pager.goToPage`; the unused key `kumiko.pager.pageOf` is removed from the catalogs, the arrows are 28px from sm); below sm "1–10 of 26" with arrows. Record file: `hideIcon` holds for the narrow label variant of step and banner actions, the step (i) icons are hidden below sm, a step action with `display: "link"` draws as a text link (it was overridden by `style`). Serif body text (dashboard lead paragraph, record summary) is 16px below sm.
-->
