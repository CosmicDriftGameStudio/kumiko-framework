---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-types": patch
---

Renderer layout review fixes: the focus rail "More" tile follows ancestry, collapsible sections report late `defaultOpen` openings, ruled legend terms wrap, pageHelp docs match the button.

<!-- kumiko-changes
feature: renderer
type: fix
title: Focus rail More state, collapsible onOpenChange and ruled legend wrapping
detail: The focus rail's More tile is active only when a hidden group holds the active screen outside every shown tile. CollapsibleSection calls onOpenChange(true) when defaultOpen flips to true after mount (the mount-time value still does not). In a ruled legend grid the term cells now wrap (min-w-0, break-words) instead of overflowing the fixed 13rem column. pageHelp docs and JSDoc describe the labelled Explanations button and the page-help/unsupported-site rule. Tests added for focus rail entries, workspace-less screen links, intro box branches and referenceLabelText.
-->
