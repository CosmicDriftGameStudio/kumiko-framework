---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
"@cosmicdrift/kumiko-types": patch
---

`ActionMenuItemSpec` takes an optional `testId` that overrides the menu entry's default `data-testid` in the action overflow menu and the phone header menu. `Button` takes `expanded` (rendered as `aria-expanded`). New icon key `chevron-up`. Below 768 px the whole `header-actions` container sits in the closed "…" menu: E2E settled checks should wait for `[data-kumiko-layout="shell-header"]` and open header actions via `shell-header-overflow-trigger`.

<!-- kumiko-changes
feature: renderer-web
type: improvement
title: Menu items accept testId, Button accepts expanded, chevron-up icon
-->
