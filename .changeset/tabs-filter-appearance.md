---
"@cosmicdrift/kumiko-renderer": patch
---

Muted tab strips space their tabs like the inbox design, and list panes get a filter appearance.

<!-- kumiko-changes
feature: renderer
type: feature
title: Tabs have a filter appearance for the filter strip of a list pane
detail: DefaultTabs takes appearance "filter" next to "pill" and "plain". It keeps the plain look (muted count, 40px strip) and insets the strip by 6px with no gap between tabs, so the first label lines up with a list pane's search field. "plain" now sits flush with its content with a 4px gap. Both pad each tab by 10px on either side and space icon, label and count by 6px; before, the count stood 12px after its label. "pill" is unchanged.
-->
