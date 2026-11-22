---
"@cosmicdrift/kumiko-bundled-features": minor
---

Building blocks for postal letters: `releaseCapUsage` is exported, cap-overview knows the `cents` unit, PDF layouts accept `postal`, and the shared PDF helpers (`mergePdfs`, `checkPostalPdf`) move out of signature.

<!-- kumiko-changes
feature: cap-counter
type: improvement
title: `releaseCapUsage` is exported
detail: `releaseCapUsage` gives back a booked amount, for example when the operation that reserved it failed afterwards. The counter never drops below 0. It is now exported from the cap-counter barrel next to `bookCapUsage`.
-->

<!-- kumiko-changes
feature: cap-overview
type: improvement
title: cap-overview shows amounts in `cents`
detail: A cap can use the unit `cents`. The card shows the value divided by 100 with two decimals in the number format of the language, without a currency symbol, so 1234 reads 12,34 in German. Name the currency in the cap label.
-->

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: PDF layouts accept `postal` to drop fold marks, corner marks, paper colour and bleed images
detail: A pdf-layout with `postal: true` prints without fold marks, corner marks and paper colour, and hides full-bleed header and footer images, even when the layout sets them. Without the field nothing changes.
-->
