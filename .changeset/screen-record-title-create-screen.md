---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer": patch
---

Screen schema gains createScreen on entityList, recordTitleField on entityEdit and fillHeight on configEdit; extension tabs render unframed

`createScreen` on an entityList names the screen opened by the create button. `recordTitleField` on an entityEdit shows a field value as the record title in the header breadcrumb (list > record > screen title). `fillHeight` on a configEdit (default true) switches it to the screen-form layout with a pinned footer; `false` restores the card layout. All three are optional and validated at boot. Extension tabs on a projectionDetail no longer wrap their content in a Card, like relatedList tabs. A `headerSlot` now renders inside the page-header slot instead of replacing the header.

<!-- kumiko-changes
feature: renderer
type: improvement
title: Screen schema gains createScreen, recordTitleField and configEdit fillHeight; extension tabs render unframed
migration: |
  Additive. Set `createScreen: "<screen-id>"` on an entityList and `recordTitleField: "<field>"` on an entityEdit to use them. configEdit screens now fill the shell height; set `fillHeight: false` to keep the card layout. Apps with screenshot tests of extension tabs lose the surrounding card frame.
-->
