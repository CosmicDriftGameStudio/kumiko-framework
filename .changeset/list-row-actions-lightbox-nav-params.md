---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

Responsive row actions, Lightbox actions, navigate with search params, fresh facet counts

`RowActionDisplay` gets `"responsive"`: a labelled button with icon in the table (768px and up), icon only in the narrow card layout with the label as accessible name. Without an icon it stays a button. Existing values keep their look. Below 768px, icon-only row actions and the row expand arrow have a 44px touch target.

`Lightbox` takes `actions` (nodes in the top-left corner, e.g. a download button) and `showPosition` (default `true`; `false` hides the `{current} / {total}` counter).

`NavApi.navigate`, `replace` and `hrefFor` take an optional `{ searchParams }` (`NavigateOptions`). Without it the query is dropped as before. `listFilterUrlKey(screenId, field)` builds the URL key a list reads a facet filter from.

Facet chip counts refetch after a write from a row action, toolbar action, drawer or expanded row, and follow the entity's live events. Before, they kept the count from the first load.

<!-- kumiko-changes
feature: renderer-web
type: improvement
title: Row actions with display "responsive", Lightbox actions and showPosition, navigate with searchParams, facet counts refresh after writes
-->
