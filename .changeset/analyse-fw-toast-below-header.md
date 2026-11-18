---
"@cosmicdrift/kumiko-renderer": patch
---

On a phone the toast starts below the shell header on an opaque surface, so it no longer covers the title bar or lets its text show through.

<!-- kumiko-changes
feature: renderer
type: fix
title: Toast below the header on narrow screens
detail: Below the `sm` breakpoint the toast viewport starts at `--shell-header-height` instead of the top edge, so the header and the bottom save bar stay visible. The toast tones use the opaque status surface tokens instead of a 10 to 15 percent tint. From `sm` up the toast stays bottom right. Nothing to do for apps; screenshot tests that show a toast on a phone change.
-->
