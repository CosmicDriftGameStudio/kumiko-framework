---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

fw#2778: a projectionDetail tab whose only content is a `relatedList` no longer stretches the tab panel to the bottom of the card when the list is short. Since fw#2722/#2737 the whole `fillHeight`/`scrollBody` chain (form card, header/body wrappers, `RelatedListSection`'s `FillContainer`, `DataTable`'s outer wrapper) used `flex-1`, which claims all remaining flex space regardless of content size. Every link in that chain except the two terminal scroll surfaces (`tableInner`/`cardsInner`) now falls back to its initial `flex: 0 1 auto` (sizing to content) while keeping `min-h-0`, so a short list sizes to its rows and a long list still caps at the panel height and scrolls internally, exactly as before. Siblings above/below the card (headerRegion, card title, footer actions, the toolbar row) got `shrink-0` so they stay uncompressed once the card itself is allowed to shrink.
