---
"@cosmicdrift/kumiko-renderer": patch
---

A rejected empty embedded list shows its error at the list, once, without a banner-only failure

<!-- kumiko-changes
feature: renderer
type: fix
title: A rejected empty embedded list shows its error at the list, once, without a banner-only failure
detail: The empty state of an embedded list now shows list-level issues (min items, required), and the surrounding field no longer prints them a second time. An issue on a derived head total that is not laid out (an empty list leaves it without a value) no longer adds the generic form banner while another issue is shown; it still shows the banner when it is the only issue.
migration: None.
-->
