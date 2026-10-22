---
"@cosmicdrift/kumiko-framework": patch
---

`validateScreens()` is now a short loop that runs the shared screen checks once and then dispatches each screen to its own validator through a table keyed by the screen kind.

<!-- kumiko-changes
feature: framework
type: improvement
title: validateScreens split into one validator per screen kind
detail: validateScreens() keeps its signature, its error messages and the order in which it reports the first error. The per-kind validators live in screens-kind-*.ts next to screens.ts, and checks shared by several kinds (empty columns or sections, header actions, write-handler registration) live in screens-kind-shared.ts and screens-actions.ts. A screen whose type is not a known kind now fails boot with an explicit "unknown type" error.
-->
