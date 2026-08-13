---
"@cosmicdrift/kumiko-renderer-web": minor
---

Drawer/form polish, four targeted changes to the `entityEdit` drawer experience:

- `Drawer`'s default width grows from `max(520px, 25vw)` to `max(600px, 37.5vw)` (capped at `85vw`) so a two-column field row (e.g. street/number, zip/city) has room to breathe: `600px` on a narrow viewport (~1280px) without the drawer dominating it, growing to `~720px` on a typical `1920px` window instead of staying pinned at the floor.
- The `Section` primitive's vertical padding inside a form (`entityEdit`, `configEdit`) drops from `py-6` to `py-4`, so the gap between two sections (padding + border-t + padding) reads as roughly double a field row's `gap-4`, not triple it. The border-t divider itself is unchanged.
- `SheetFooter`'s background changes from `bg-muted/30` to `bg-background`, matching the panel body above it. The `border-t` divider alone now marks the footer boundary.
- `Drawer` gets a new optional `showCloseButton` prop (default `true`, passed through to the underlying `SheetContent`) so a caller with its own footer close/cancel action can turn off the redundant header X.
