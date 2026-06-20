---
"@cosmicdrift/kumiko-renderer-web": minor
---

Refresh the auto-UI default to a polished shadcn "new-york" standard:

- **Tokens** (`styles.css`): the default palette moves from the Linear-style
  blue-grey + purple to neutral zinc with a near-black primary and visibly
  stronger borders, in both light and dark. App-level `@theme` token overrides
  are unaffected — apps keep their brand colors and only inherit the polish.
- **Forms are one card**: `DefaultForm` renders the whole edit form as a single
  `bg-card` panel — title as the card header, sections as `border-t`-divided
  inner regions (no longer separate floating cards), and the action buttons in
  the card footer at the bottom (shadcn Shipping/Invoice/Profile pattern). Form
  bodies are centered at `max-w-3xl`. Standalone `Section` use (outside a form)
  keeps its own card surface, switched via a form context.
- **Lists are cards**: `DefaultDataTable` wraps the table in a `rounded-lg border`
  surface with a `bg-muted` header bar and `outline` status badges (dashboard-01).
- **Cleaner headers**: the form action bar and list toolbar drop the `bg-muted/30`
  tint for a flat `bg-background` + border-b.

**Shell/Nav now use real (vendored) shadcn (`sidebar-07` block).** Instead of a
hand-rolled mini-shadcn, `DefaultAppShell` is built on shadcn's `SidebarProvider`
+ `Sidebar collapsible="icon"` + `SidebarInset`: a `SidebarBrand` team-switcher
header, a `SidebarUser` profile footer, a header carrying a sidebar trigger and a
breadcrumb of the active screen, a collapsible-icon rail, and a working mobile
sidebar sheet (previously the sidebar was simply hidden on mobile). `NavTree` renders
through shadcn's `SidebarMenu`/`SidebarMenuButton`/`SidebarGroup` — schema sections
are static labels, items-with-children collapse. Navigation logic (role-gating,
grouping, icons, active state) is unchanged. The
vendored shadcn source lives in `src/ui/` (Tailwind-v4-native `new-york-v4` registry)
and is regenerated via `scripts/sync-shadcn.ts`, never edited by hand. Adds `radix-ui`
as a dependency (the unified Radix package shadcn v4 imports from). A new
`--color-sidebar*` token family (8 members) drives the sidebar surface.

**Tables, forms and inputs now use vendored shadcn too.** `DataTable` renders through
shadcn's `Table`/`TableHeader`/`TableRow`/`TableCell` with status columns as `Badge`s
(Kumiko's sort/paging/row-actions/infinite-scroll logic is unchanged). `Button` maps to
shadcn's `Button` (primary→default, secondary→outline, danger→destructive), text inputs
to `Input`/`Textarea`, boolean fields to a Radix `Checkbox`, and field labels to `Label`.
Error styling now comes for free from `aria-invalid`. Boolean fields render
`button[role="checkbox"]` instead of a native `input[type="checkbox"]`.

Purely visual — no API or prop changes. Apps that supplied their own
`primitives` overrides are untouched. A new `styleguide` sample app + a 3-theme
screenshot runner back this; its gallery now also includes real-world reference
blocks (login, invoice, shipping address, profile, dividends, savings targets,
holdings filter) composed purely from the shadcn tokens. The docs gain a
"Design system → Styleguide" page showing every block in light / dark / brand.
