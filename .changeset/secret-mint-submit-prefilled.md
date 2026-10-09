---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
---

actionForm and secretMint screens gain `submitPrefilled`: a row action that navigates in with `params` can submit the form right away, with the record id carried in a hidden or read-only field.

<!-- kumiko-changes
feature: framework
type: improvement
title: Row actions can open a secretMint or actionForm that submits without edits
-->
