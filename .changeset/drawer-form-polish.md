---
"@cosmicdrift/kumiko-renderer-web": minor
---

Drawer/form polish, four targeted changes to the `entityEdit` drawer experience:

- `Drawer`'s default width floor grows from `520px` to `600px` (still `max(600px, 25vw)`, capped at `85vw`) so a two-column field row (e.g. street/number, zip/city) has room to breathe without the drawer dominating a narrow viewport.
- The `Section` primitive's vertical padding inside a form (`entityEdit`, `configEdit`) drops from `py-6` to `py-4`, so the gap between two sections (padding + border-t + padding) reads as roughly double a field row's `gap-4`, not triple it. The border-t divider itself is unchanged.
- `SheetFooter`'s background changes from `bg-muted/30` to `bg-background`, matching the panel body above it. The `border-t` divider alone now marks the footer boundary.
- `Drawer` gets a new optional `showCloseButton` prop (default `true`, passed through to the underlying `SheetContent`) so a caller with its own footer close/cancel action can turn off the redundant header X.
