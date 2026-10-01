---
"@cosmicdrift/kumiko-renderer-web": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
---

Narrow-card meta separator ("·") is now rendered as an element instead of `before:content`, so it survives consumer Tailwind scans of the published dist. The value span keeps its `data-testid` and exact text. The mobile page-header overflow trigger (`shell-header-overflow-trigger`) now has its own aria-label "Page actions" (was "More actions", same as row menus); E2E selectors by label need updating.
