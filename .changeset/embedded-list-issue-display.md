---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

A rejected empty embedded list shows its error at the list, once, without a banner-only failure

<!-- kumiko-changes
feature: renderer
type: fix
title: A rejected empty embedded list shows its error at the list, once, without a banner-only failure
detail: The empty state of an embedded list now shows list-level issues (min items, required), and the surrounding field no longer prints them a second time. An issue on a derived head total that is not laid out (an empty list leaves it without a value) no longer adds the generic form banner while another issue is shown; it still shows the banner when it is the only issue. A list below its minItems now reads "At least 1 row required." / "At least N rows required." (errors.validation.list_min_rows.one and .other) instead of the generic too-small text. Only embedded lists get the row wording (their schema reports a custom issue with params.i18nKey and minimum, which both zod bridges now forward); other arrays such as a required multiSelect keep errors.validation.too_small.
migration: None.
-->
