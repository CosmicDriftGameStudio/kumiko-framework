---
"@cosmicdrift/kumiko-renderer": patch
---

The renderer imports Radix from the `radix-ui` meta package only, so the renderer resolves a single copy of `react-dismissable-layer` in this repo. Two copies broke outside-click and Escape handling of stacked layers.

<!-- kumiko-changes
feature: renderer
type: fix
title: One copy of Radix dismissable layers
detail: Dialog, Popover, DropdownMenu and Toast now come from the radix-ui package instead of the single @radix-ui/react-* packages, which dropped nine direct dependencies. A root override pins @radix-ui/react-dialog to 1.3.1 because cmdk would otherwise pull an older dialog with its own react-dismissable-layer. Apps that import @radix-ui/react-* themselves, or add cmdk, should align their own lockfile to one react-dialog version.
-->
