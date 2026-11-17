---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-guards": patch
---

The shared renderer layer (app/, components/) no longer uses DOM tags or `[&…]` selector variants; the renderer-boundaries guard enforces both.

<!-- kumiko-changes
feature: renderer
type: improvement
title: Shared renderer layer styles through primitive props instead of DOM selectors
detail: New primitive props replace the selector hacks in the platform-neutral layer: `FormWidth` "settings" (940px column, used by configEdit `compact`), RenderEdit `fieldIcons: false`, `CardOptions.headerPadding: "flush"`, `DataTableProps.headerTone: "muted"`, `MetricBandProps.splitPart`, `SectionProps.titleOnNarrow: false` and `FillContainerProps.dataAttributes`. The renderer-boundaries guard now also catches a lowercase JSX tag whose opening spans several lines and reports `[&…]` arbitrary variants in app/ and components/. The look stays the same.
-->
