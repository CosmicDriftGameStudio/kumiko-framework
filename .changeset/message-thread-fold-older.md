---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-fr": minor
"@cosmicdrift/kumiko-locale-es": minor
"@cosmicdrift/kumiko-locale-it": minor
---

MessageThread can fold its older messages into one toggle, a clamped mail offers "Ganze Mail lesen", and a phone card step list reads the waiting reason as plain text.

<!-- kumiko-changes
feature: renderer
type: feature
title: Thread folds older mails for a phone, step waiting reason as text on a phone
detail: `foldOlderTogether` on MessageThread shows one "2 frühere Mails anzeigen" toggle above the newest mail instead of a row per older message; a click lists them as rows. The toggle under a clamped mail body now reads "Ganze Mail lesen" (en "Read the whole mail"). A StepList with `phoneCard` shows a locked step's "Wartet auf" reason as a plain 13px line below the md breakpoint and keeps the badge on desktop.
-->
