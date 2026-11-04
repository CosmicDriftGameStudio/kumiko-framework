---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

Lists and record screens get guidance building blocks: row tint, a "to do" hint column, and breadcrumb, summary, banner and steps blocks on projectionDetail. The dashboard list panel, text panel and stat tile get matching options.

<!-- kumiko-changes
feature: renderer
type: improvement
title: row tone, hint column and record guidance blocks
detail: entityList and projectionList take `rowToneField` (row tint from a tone field). A column takes `hint: { detailField?, toneField?, reasonField?, emptyLabel? }` for a sentence cell with detail line, tone and a "Why?" toggle (shown open when the cell sits inside a row-open button), plus `linkParamsField` next to `linkScreenField`. projectionDetail takes `breadcrumb`, `summary`, `banner` and `steps`, each reading a field of the query row; `banner.actions` and `steps.actions` are evaluated against the notice or step like list rows. Dashboard list panels accept `rowToneField`, `hint`, `linkScreenField` and `linkParamsField`, text panels accept a `query` (static `blocks` stay as fallback), and `navigate.params` on stat panels. New optional web primitives `RecordBreadcrumb`, `RecordSummary`, `RecordSteps` (fallbacks from the core primitives), new i18n keys `kumiko.list.hint.empty|reason` and `kumiko.detail.steps.title|empty|reason`, `kumiko.detail.breadcrumb` (en, de, es, fr, it), new boot rules `list/hint-column-renderer`, `list/hint-column-display`, `list/hint-column-link`, `list/link-params-without-screen-field`, `list/guidance-field-empty`, `projection-detail/guidance-field-empty`, `projection-detail/guidance-action-show-on-tabs`, `dashboard/stat-navigate-params-invalid`.
-->
