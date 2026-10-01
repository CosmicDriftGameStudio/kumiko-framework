---
"@cosmicdrift/kumiko-renderer-web": patch
---

Card subtitles never show a "·" separator at the start of a line

On phones the card meta values wrap as whole items onto at most two lines. The separator in front of a value that starts a line is clipped, and a single value too long for a line is truncated with an ellipsis.

<!-- kumiko-changes
feature: renderer-web
type: fix
title: Card subtitle separators no longer appear at the start of a wrapped line
-->
