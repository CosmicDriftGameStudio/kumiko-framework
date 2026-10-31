---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-fr": minor
"@cosmicdrift/kumiko-locale-es": minor
"@cosmicdrift/kumiko-locale-it": minor
---

MessageThread can fold its older messages into one toggle for a phone, where a clamped mail offers "Ganze Mail lesen", and a phone card step list reads the waiting reason as plain text.

<!-- kumiko-changes
feature: renderer
type: feature
title: Thread folds older mails for a phone, step waiting reason as text on a phone
detail: `foldOlderTogether` on MessageThread shows one "2 frühere Mails anzeigen" toggle above the newest mail instead of a row per older message; a click lists them as rows. In such a folded thread the toggle under a clamped mail body reads "Ganze Mail lesen" (en "Read the whole mail"); every other thread keeps "Mehr anzeigen". There an html mail is cut to the same lines by height; html mails in other threads still show whole. A folded thread uses narrow phone padding (SenderSheet `compact`). In every html mail the first block no longer adds its top margin above the text. In a folded thread the last mail's attachments render as full-width `AttachmentCard`s below the thread frame instead of chips (`MessageAttachment.thumbnailUrl` is new). New widget `AttachmentCard` shows a thumbnail or kind icon, name, second line and a "Original ansehen" link or button. New theme tokens `search-hit`, `search-hit-active` and `source-mark` (`bg-search-hit`, `bg-search-hit-active`, `bg-source-mark`) color PDF search hits, the active hit and a host-marked source passage. Plain and filter tab strips use normal weight for inactive tabs. A StepList with `phoneCard` shows a locked step's "Wartet auf" reason as a plain 13px line below the md breakpoint and keeps the badge on desktop.
-->
