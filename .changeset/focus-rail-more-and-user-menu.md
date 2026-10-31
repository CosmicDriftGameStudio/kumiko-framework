---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

The focus rail keeps the sidebar footer and can show a chosen set of entries with a "More" tile for the rest. HTML mails end at their signature.

<!-- kumiko-changes
feature: renderer
type: improvement
title: Focus rail with user menu and a "More" tile
detail: A focused screen's icon rail now pins the shell's sidebarFooter (for example the sidebar UserMenu) to its bottom, so profile and logout stay reachable. WorkspaceShell and DefaultAppShell take focusRailNavQns, the top-level nav QNs the rail shows as tiles; the other entries sit behind a "More" tile that opens the full sidebar and is marked active when the current screen lives there. New nav icon keys "warehouse" and "euro". An HTML mail whose quote is folded drops the Gmail separator break and the last paragraph's bottom margin, so the quote toggle sits right under the signature.
-->
