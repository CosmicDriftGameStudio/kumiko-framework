---
"@cosmicdrift/kumiko-renderer": patch
---

Cards keep their cell links tappable and focused screens show the shell's topbar actions on phones.

<!-- kumiko-changes
feature: renderer
type: fix
title: Cards keep their cell links tappable and focused screens show the shell's topbar actions on phones
detail: A cell link on a card with a row opener sat inside the opener button and was rendered as plain text. The MobileTopBar of a focused screen only received the overflow menu, so the shell's topbarActions were missing on phones.
-->
