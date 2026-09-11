---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

Record-Akte "Bedienkonzept": tabbed detail screens render without a nested card and show a record-field count in the tab label; the metrics band supports click-to-navigate metrics with an overridable label and no longer requires a `fieldLabels` entry when the metric declares its own; the record header subtitle can link out to an absolute URL; header actions never collapse to icon-only, and row actions always keep `[Bearbeiten]` as a visible text button with the rest collapsed to a kebab menu; and `SidebarPanel` gained a `tone="surface"` option for lists that need content colors instead of navigation chrome. Also fixes the confirm dialog so Enter confirms instead of accidentally cancelling.
