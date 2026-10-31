---
"@cosmicdrift/kumiko-renderer": minor
---

StepList can read as a card on a phone, and the MobileTopBar sits on the card surface with a 13px label.

<!-- kumiko-changes
feature: renderer
type: improvement
title: StepList phone card, quieter mobile top bar
detail: `phoneCard` on StepList keeps the desktop panel and, below the md breakpoint, puts the header inside the rounded surface and the steps in a framed white box with tighter rows; the progress bar is left out there. MobileTopBar uses the card background instead of the page background, a 13px label and a 4px gap, like the phone reader design.
-->
