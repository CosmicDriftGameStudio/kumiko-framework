---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

Phone-width shell header keeps the title readable and moves actions into one menu

Below 768px the shell header no longer squeezes or clips the title next to header actions. The title stays on one line with an ellipsis and takes the free space. The primary action renders as an icon-only button with `aria-label` and tooltip; a primary that is `style: "danger"`, needs a confirm, or has no icon goes into the menu instead. All other screen actions and the app's `headerActions` move into a single "…" menu in the shell header. This applies to entityList, edit and projectionDetail screens without any app opt-in. Desktop layout is unchanged.

`PageHeaderProps` gains `overflowItems` (screen actions for that menu), and `usePageHeaderCompact()` tells a screen whether the compact header is active. App header actions stay mounted while the menu is closed, so global listeners such as a ⌘K shortcut keep working. Icon-only buttons now get `title` from `ariaLabel` when no title is set.

Also on phones: card subtitles with several meta values wrap to two lines instead of truncating each value; dates, numbers, money and badges never break inside. In the inline form table, "add row" sits below the horizontal scroll area so it stays reachable, and row action buttons in the card layout are 40px.

<!-- kumiko-changes
feature: renderer-web
type: improvement
title: Phone-width header keeps the title and collects actions in one menu; card meta wraps; inline table add-row stays reachable
migration: |
  No code change is required. Below 768px, app `headerActions` and secondary screen actions now live in the shell's "…" menu (`shell-header-overflow-trigger`, panel `shell-header-overflow`, items `shell-header-overflow-item-<actionId>`). Mobile e2e tests that clicked these buttons inline must open the menu first. The list "create" button keeps its test id but has no visible text on phones; select it by its aria-label. App header actions stay mounted while the menu is closed, so keyboard shortcuts registered in effects keep working. Apps that replace the `PageHeader` primitive lose the secondary actions on phones, because only the default primitive forwards `overflowItems` to the shell menu.
-->
