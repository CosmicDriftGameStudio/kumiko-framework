---
"@cosmicdrift/kumiko-testing": patch
---

The DOM preload's bounded print of nodes now covers SVG elements too. Before, printing an `<svg>` in a failed assertion dumped the whole happy-dom object graph (about 10 MB).

<!-- kumiko-changes
feature: testing
type: fix
title: DOM preload bounds the printed output of SVG elements as well
-->
