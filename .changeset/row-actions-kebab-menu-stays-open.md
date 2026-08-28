---
"@cosmicdrift/kumiko-renderer-web": patch
---

Fix `RowActionsKebab`'s dropdown menu staying open (and its Radix overlay lock, `aria-hidden` on the app root plus `body.style.pointerEvents: none`, never releasing) after a confirm-guarded row action finished. The menu is now controlled and closes explicitly in `onSelect`, since the unconditional `preventDefault()` there was blocking Radix's own auto-close.
