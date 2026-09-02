---
"@cosmicdrift/kumiko-renderer-web": patch
---

Fixes fw#2528: the shared `cardFooter` action-bar row (`Form`/`Section`/`Card`, including `stickyActions`) now wraps instead of overflowing off-screen once its buttons no longer fit — on a 390px viewport a five-button wizard footer left the leftmost buttons (Cancel, Back) unreachable, with no way to scroll them into view under `stickyActions`' fixed positioning. `Form`'s `stickyActions` mobile content-padding grew from `max-sm:pb-24` to `max-sm:pb-32` to keep the last field clear of a two-row wrapped footer. `Drawer`'s footer row shares the same unwrapped shape (its own comment notes it mirrors `cardFooter`) and gets the same fix.
