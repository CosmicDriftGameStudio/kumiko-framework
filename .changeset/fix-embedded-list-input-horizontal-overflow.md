---
"@cosmicdrift/kumiko-renderer-web": patch
---

`EmbeddedListInput`'s desktop table is now horizontally scrollable when it has more columns than its container is wide, with a visible edge shadow while there's more to scroll. Previously the table wrapper clipped overflowing columns outright (`overflow-hidden`) — the browser could still nudge the hidden scroll position when a descendant received focus, so tabbing through a row could silently shift the table left (fw#2159, follow-up to #2092: reachability of the table as a whole, not just cell-content clipping within a column). A fresh table (or one crossing the mobile/desktop breakpoint) always mounts scrolled fully left.
