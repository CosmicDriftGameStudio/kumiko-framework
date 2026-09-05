---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

Form action bars now group into two rows: destructive/record actions (Delete, copy-link, custom actions, Cancel) on their own row, wizard/submit navigation on the other — desktop shows them side by side, narrow viewports stack the primary action on top. Buttons gained `icon`/`iconEnd` props (resolved against the shared `NavIconKey` vocabulary, now covering button icons too) and a new `danger-ghost` variant for destructive actions rendered as red text instead of a red fill.
