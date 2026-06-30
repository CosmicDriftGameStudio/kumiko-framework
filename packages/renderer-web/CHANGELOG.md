# @cosmicdrift/kumiko-renderer-web

## 0.103.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.103.0
- @cosmicdrift/kumiko-renderer@0.103.0
- @cosmicdrift/kumiko-dispatcher-live@0.103.0

## 0.102.2

### Patch Changes

- Updated dependencies [cfc5895]
  - @cosmicdrift/kumiko-headless@0.102.2
  - @cosmicdrift/kumiko-dispatcher-live@0.102.2
  - @cosmicdrift/kumiko-renderer@0.102.2

## 0.102.1

### Patch Changes

- Updated dependencies [e0b88c7]
  - @cosmicdrift/kumiko-headless@0.102.1
  - @cosmicdrift/kumiko-dispatcher-live@0.102.1
  - @cosmicdrift/kumiko-renderer@0.102.1

## 0.102.0

### Patch Changes

- Updated dependencies [4659e52]
  - @cosmicdrift/kumiko-headless@0.102.0
  - @cosmicdrift/kumiko-dispatcher-live@0.102.0
  - @cosmicdrift/kumiko-renderer@0.102.0

## 0.101.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.101.0
- @cosmicdrift/kumiko-headless@0.101.0
- @cosmicdrift/kumiko-renderer@0.101.0

## 0.100.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.100.0
- @cosmicdrift/kumiko-renderer@0.100.0
- @cosmicdrift/kumiko-dispatcher-live@0.100.0

## 0.99.0

### Patch Changes

- Updated dependencies [8146e5b]
  - @cosmicdrift/kumiko-headless@0.99.0
  - @cosmicdrift/kumiko-renderer@0.99.0
  - @cosmicdrift/kumiko-dispatcher-live@0.99.0

## 0.98.0

### Patch Changes

- Updated dependencies [4c39e11]
  - @cosmicdrift/kumiko-renderer@0.98.0
  - @cosmicdrift/kumiko-dispatcher-live@0.98.0
  - @cosmicdrift/kumiko-headless@0.98.0

## 0.97.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.97.1
- @cosmicdrift/kumiko-renderer@0.97.1
- @cosmicdrift/kumiko-dispatcher-live@0.97.1

## 0.97.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.97.0
- @cosmicdrift/kumiko-renderer@0.97.0
- @cosmicdrift/kumiko-dispatcher-live@0.97.0

## 0.96.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.96.0
- @cosmicdrift/kumiko-headless@0.96.0
- @cosmicdrift/kumiko-renderer@0.96.0

## 0.95.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.95.0
- @cosmicdrift/kumiko-renderer@0.95.0
- @cosmicdrift/kumiko-dispatcher-live@0.95.0

## 0.94.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.94.0
- @cosmicdrift/kumiko-renderer@0.94.0
- @cosmicdrift/kumiko-dispatcher-live@0.94.0

## 0.93.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.93.0
- @cosmicdrift/kumiko-renderer@0.93.0
- @cosmicdrift/kumiko-dispatcher-live@0.93.0

## 0.92.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.92.0
- @cosmicdrift/kumiko-headless@0.92.0
- @cosmicdrift/kumiko-renderer@0.92.0

## 0.91.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.91.0
- @cosmicdrift/kumiko-headless@0.91.0
- @cosmicdrift/kumiko-renderer@0.91.0

## 0.90.3

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.90.3
- @cosmicdrift/kumiko-headless@0.90.3
- @cosmicdrift/kumiko-renderer@0.90.3

## 0.90.2

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.90.2
- @cosmicdrift/kumiko-headless@0.90.2
- @cosmicdrift/kumiko-renderer@0.90.2

## 0.90.1

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.90.1
- @cosmicdrift/kumiko-headless@0.90.1
- @cosmicdrift/kumiko-renderer@0.90.1

## 0.90.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.90.0
- @cosmicdrift/kumiko-headless@0.90.0
- @cosmicdrift/kumiko-renderer@0.90.0

## 0.89.0

### Patch Changes

- Updated dependencies [4722d4e]
  - @cosmicdrift/kumiko-renderer@0.89.0
  - @cosmicdrift/kumiko-headless@0.89.0
  - @cosmicdrift/kumiko-dispatcher-live@0.89.0

## 0.88.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.88.0
- @cosmicdrift/kumiko-headless@0.88.0
- @cosmicdrift/kumiko-renderer@0.88.0

## 0.87.3

### Patch Changes

- @cosmicdrift/kumiko-headless@0.87.3
- @cosmicdrift/kumiko-renderer@0.87.3
- @cosmicdrift/kumiko-dispatcher-live@0.87.3

## 0.87.2

### Patch Changes

- b04ca86: Fix tenant privilege escalation via membership roles. `hasAccess` checks session roles flat with no notion of origin, so a platform-global role (`SystemAdmin`/`system`) landing in a tenant membership merged into the session and unlocked the SystemAdmin-gated, cross-tenant handler surface — a Tenant-Admin could invite `SystemAdmin` and the invitee gained platform-wide, cross-tenant access.

  Reject reserved/global roles (`system`, `SystemAdmin`, `all`, `anonymous`) at every tenant-membership write chokepoint: `seedTenantMembership` (covers the three invite-accept branches plus seeding), `add-member`, `update-member-roles`, and early in `invite-create`. The bootstrap path was already correct (SystemAdmin lives in global `users.roles`, never in a membership); this makes the invite path consistent.

  Also centralize the `tenantIdOverride` SystemAdmin gate into a new `crossTenantOverrideDenied` helper (exported from `@cosmicdrift/kumiko-framework/engine`), replacing the inline check duplicated across managed-pages, compliance-profiles, text-content and template-resolver so a future override handler can't skip it.

- Updated dependencies [b04ca86]
  - @cosmicdrift/kumiko-dispatcher-live@0.87.2
  - @cosmicdrift/kumiko-headless@0.87.2
  - @cosmicdrift/kumiko-renderer@0.87.2

## 0.87.1

### Patch Changes

- cb2abcd: Session bootstrap only mounts behind SessionAuthGate so public SPA gates (e.g. `/rechner`) no longer call `/api/auth/tenants`. Skip refresh when no `kumiko_csrf` cookie is present.
- Updated dependencies [cb2abcd]
  - @cosmicdrift/kumiko-renderer@0.87.1
  - @cosmicdrift/kumiko-headless@0.87.1
  - @cosmicdrift/kumiko-dispatcher-live@0.87.1

## 0.87.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.87.0
- @cosmicdrift/kumiko-renderer@0.87.0
- @cosmicdrift/kumiko-dispatcher-live@0.87.0

## 0.86.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.86.0
- @cosmicdrift/kumiko-renderer@0.86.0
- @cosmicdrift/kumiko-dispatcher-live@0.86.0

## 0.85.0

### Patch Changes

- Updated dependencies [2cdfe9d]
  - @cosmicdrift/kumiko-headless@0.85.0
  - @cosmicdrift/kumiko-dispatcher-live@0.85.0
  - @cosmicdrift/kumiko-renderer@0.85.0

## 0.84.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.84.0
- @cosmicdrift/kumiko-renderer@0.84.0
- @cosmicdrift/kumiko-dispatcher-live@0.84.0

## 0.83.0

### Patch Changes

- Updated dependencies [c2b7154]
  - @cosmicdrift/kumiko-renderer@0.83.0
  - @cosmicdrift/kumiko-headless@0.83.0
  - @cosmicdrift/kumiko-dispatcher-live@0.83.0

## 0.82.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.82.0
- @cosmicdrift/kumiko-headless@0.82.0
- @cosmicdrift/kumiko-renderer@0.82.0

## 0.81.1

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.81.1
- @cosmicdrift/kumiko-headless@0.81.1
- @cosmicdrift/kumiko-renderer@0.81.1

## 0.81.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.81.0
- @cosmicdrift/kumiko-headless@0.81.0
- @cosmicdrift/kumiko-renderer@0.81.0

## 0.80.0

### Minor Changes

- 407ed37: Add a single `Card` primitive (slot- + options-based) and route all card chrome through it.

  `usePrimitives().Card` takes `slots` (`header`/`title`/`subtitle`/`headerActions`/`footer`) and `options` (`padded`/`radius`/`footerBordered`). `DefaultForm` and `DefaultSection` now render through `DefaultCard`, so every consumer gets one consistent chrome (border, radius, shadow, footer row) without re-migrating. `AuthCard` and the `user-data-rights` / `user-profile` self-service screens use it; action buttons live in the card footer. testIds are preserved.

### Patch Changes

- Updated dependencies [407ed37]
  - @cosmicdrift/kumiko-renderer@0.80.0
  - @cosmicdrift/kumiko-dispatcher-live@0.80.0
  - @cosmicdrift/kumiko-headless@0.80.0

## 0.79.3

### Patch Changes

- cd34ef3: fix(user-data-rights): logged-in export download no longer returns 403 csrf_token_mismatch

  The privacy-center download was a plain `<a href>` to the `by-job` httpRoute, which
  re-dispatched an internal `POST /api/query` carrying only the auth cookie (no
  `X-CSRF-Token` header) — so the CSRF double-submit check rejected it with 403. The
  download now goes through the dispatcher via a new `postWithDownload` helper
  (`@cosmicdrift/kumiko-renderer-web`), which carries the CSRF token like every other
  authenticated request and navigates to the returned signed URL. The `by-job`
  httpRoute and its header-forwarding are removed; `download-by-job` reads the audit
  IP from the server-trusted request context instead of a client-supplied payload.

  - @cosmicdrift/kumiko-headless@0.79.3
  - @cosmicdrift/kumiko-renderer@0.79.3
  - @cosmicdrift/kumiko-dispatcher-live@0.79.3

## 0.79.2

### Patch Changes

- @cosmicdrift/kumiko-headless@0.79.2
- @cosmicdrift/kumiko-renderer@0.79.2
- @cosmicdrift/kumiko-dispatcher-live@0.79.2

## 0.79.1

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.79.1
- @cosmicdrift/kumiko-headless@0.79.1
- @cosmicdrift/kumiko-renderer@0.79.1

## 0.79.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.79.0
- @cosmicdrift/kumiko-headless@0.79.0
- @cosmicdrift/kumiko-renderer@0.79.0

## 0.78.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.78.0
- @cosmicdrift/kumiko-headless@0.78.0
- @cosmicdrift/kumiko-renderer@0.78.0

## 0.77.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.77.1
- @cosmicdrift/kumiko-renderer@0.77.1
- @cosmicdrift/kumiko-dispatcher-live@0.77.1

## 0.77.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.77.0
- @cosmicdrift/kumiko-headless@0.77.0
- @cosmicdrift/kumiko-renderer@0.77.0

## 0.76.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.76.1
- @cosmicdrift/kumiko-renderer@0.76.1
- @cosmicdrift/kumiko-dispatcher-live@0.76.1

## 0.76.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.76.0
- @cosmicdrift/kumiko-renderer@0.76.0
- @cosmicdrift/kumiko-dispatcher-live@0.76.0

## 0.75.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.75.0
- @cosmicdrift/kumiko-headless@0.75.0
- @cosmicdrift/kumiko-renderer@0.75.0

## 0.74.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.74.0
- @cosmicdrift/kumiko-headless@0.74.0
- @cosmicdrift/kumiko-renderer@0.74.0

## 0.73.0

### Minor Changes

- 8aae416: Cross-tenant SystemAdmin admin screens for users + tenants, plus two admin-UI polish fixes

  The bundled `user` and `tenant` features now ship SystemAdmin-gated `entityList` + `entityEdit` screens (`user-list`/`user-edit`, `tenant-list`/`tenant-edit`). Because both features run with `systemScope()`, the lists return every user/tenant across all tenants — the platform-operator roster — with no custom queries. The screens are inert until an app navs them, so existing apps are unaffected; an app gets a full list/detail/edit surface (plus create for users) by adding a single nav entry pointing at the screen. This is the cross-feature gap the boot-validator forbids apps from filling themselves: the screens have to live in the feature that owns the entity.

  The `tenant` feature gained entity-convention handlers (`tenant:query:tenant:{list,detail}`, `tenant:write:tenant:update`) alongside its legacy `tenant:query:list` / `tenant:write:update` ones, so the screens resolve a live data path without renaming anything existing. There is no hard delete (tenants are disabled via `isEnabled`, users go through the GDPR status/forget flow), and the user `roles` field is intentionally not editable from the form (it is a raw-JSON privilege column). A generic `kumiko.actions.edit` default translation backs the list row-action.

  Admin-UI polish: the `DataTable` action column no longer draws a permanent left divider (the sticky background already separates it during horizontal scroll), and `SidebarBrand` only renders its `ChevronsUpDown` affordance when the new optional `collapsible` prop is set — without a wrapping dropdown the chevron suggested a menu that never opened.

### Patch Changes

- Updated dependencies [8aae416]
  - @cosmicdrift/kumiko-renderer@0.73.0
  - @cosmicdrift/kumiko-dispatcher-live@0.73.0
  - @cosmicdrift/kumiko-headless@0.73.0

## 0.72.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.72.0
- @cosmicdrift/kumiko-renderer@0.72.0
- @cosmicdrift/kumiko-dispatcher-live@0.72.0

## 0.71.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.71.0
- @cosmicdrift/kumiko-renderer@0.71.0
- @cosmicdrift/kumiko-dispatcher-live@0.71.0

## 0.70.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.70.0
- @cosmicdrift/kumiko-renderer@0.70.0
- @cosmicdrift/kumiko-dispatcher-live@0.70.0

## 0.69.0

### Minor Changes

- 18b5cc5: UI new-york alignment (framework batch):

  - `<Section>` / `<Form>` carry `subtitle` + an elevated `actions` footer-row; the
    hard header-divider is gone (title flows into the body, shadcn pattern).
  - `DefaultAppShell` gains a `headerActions` slot (right of the breadcrumb) for the
    theme toggle / global actions.
  - `NavTree` + `DefaultAppShell` gain `navBadges` — a per-leaf runtime badge slot
    keyed by bare nav-id; the app supplies value + color (e.g. a tier badge) without
    baking it into the static nav schema.
  - Bundled `ProfileScreen` adopts the one-card-per-section standard (no more card-in-
    card) with a two-column layout for the short account forms; bundled `TagSection`
    moves its create-tag input + button onto one inline row.

### Patch Changes

- Updated dependencies [18b5cc5]
  - @cosmicdrift/kumiko-renderer@0.69.0
  - @cosmicdrift/kumiko-dispatcher-live@0.69.0
  - @cosmicdrift/kumiko-headless@0.69.0

## 0.68.0

### Minor Changes

- d9a62f9: feat(auth): UserMenu sidebar variant — full NavUser footer row across all apps

  The app shell's `sidebarFooter` slot wants the sidebar-07 NavUser row (avatar +
  name + email + chevron), but the bundled `UserMenu` only rendered a compact topbar
  pill, and `SidebarUser` is display-only (no logout/profile actions). Apps were stuck
  choosing between the polished row OR the actions.

  `UserMenu` now takes `variant?: "pill" | "sidebar"` (default `"pill"`, unchanged).
  `variant="sidebar"` renders the full NavUser row as the dropdown trigger — same look
  as `SidebarUser`, but clickable with the existing logout/profile menu. Drop it into
  `sidebarFooter` and every Kumiko app gets the consistent account row.

  renderer-web now also exports `SidebarMenu`, `SidebarMenuItem`, `SidebarMenuButton`
  and `SidebarProvider` so apps can compose custom sidebar content.

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.68.0
- @cosmicdrift/kumiko-headless@0.68.0
- @cosmicdrift/kumiko-renderer@0.68.0

## 0.67.1

### Patch Changes

- f5a8a83: fix(renderer-web): robust one-card forms, bare auth forms, missing nav icons

  The 0.66 shadcn "new-york" refresh broke three compositions:

  - **Flat-field forms** (custom screens like the money-horse credit calculator pass
    bare `<Field>` children, no `<Section>`) drew a divider line between _every_ field
    and rendered edge-to-edge. The form body now scopes dividers to consecutive
    `<section>` children only and pads flat children — sectioned auto-UI edit forms are
    unchanged.
  - **Auth screens** render `<Form>` inside `<AuthCard>`; the self-carding form produced
    a card-in-card. `AuthCard` now wraps its children in the new exported
    `BareFormProvider`, so `DefaultForm` renders a bare stacked `<form>` when embedded.
  - **NAV_ICONS** was missing `layers` and `building`, so those nav entries fell back to
    the dot. Both lucide icons are now registered.
  - @cosmicdrift/kumiko-dispatcher-live@0.67.1
  - @cosmicdrift/kumiko-headless@0.67.1
  - @cosmicdrift/kumiko-renderer@0.67.1

## 0.67.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.67.0
- @cosmicdrift/kumiko-renderer@0.67.0
- @cosmicdrift/kumiko-dispatcher-live@0.67.0

## 0.66.0

### Minor Changes

- 77ed9c1: Let the config-generated entity-edit form express the common shadcn form
  shapes (title + subtitle, flat single-section layout, domain-specific submit
  CTA). Driven by rebuilding real shadcn reference designs purely from the schema
  to find what the auto-UI couldn't yet do:

  - **Optional section title**: `EditFieldsSection.title` is now optional. A
    title-less section renders just its fields (no `h3`), so a form can be a flat
    "card title + fields directly" layout instead of being forced into a labelled
    sub-section. The whole-form card title/subtitle carries the context.
  - **entityEdit submit label**: `EntityEditScreenDefinition.submitLabel` (i18n key
    or raw string) overrides the generic "Save" — e.g. "Save Address", "Create
    item". Wired through `KumikoScreen` (create + update branches) into the
    existing `RenderEdit` `submitLabel` prop.
  - **Form subtitle**: `FormProps.subtitle` renders a muted line under the form
    title. `RenderEdit` resolves title + subtitle create/edit-aware via
    `screen:<id>.<create|edit>.title` / `.subtitle` (falling back to
    `screen:<id>.title`/`.subtitle`, then the screen id), so a create screen reads
    "Create item / Add a new item to your catalog" and the edit screen differs.

  No breaking changes — existing titled sections and the default save label are
  unaffected. A new `styleguide` "Examples" feature rebuilds the shadcn Shipping
  Address design from a schema as the first config stress-test.

- 7eacfcb: The config-generated edit form now renders `file` / `image` fields as a real
  upload widget — image fields show a round avatar preview + Upload/Change/Remove
  buttons, file fields show an attach control. The file storage backend (POST/GET
  `/api/files`, `FileStorageProvider`, `fileRef` entity) already existed; this
  wires it through to the auto-UI, discovered by rebuilding the shadcn Profile
  design purely from a schema.

  - **Renderer**: `InputProps` gains a `file | image` kind; `RenderField` maps
    `createImageField()`/`createFileField()` to it and threads `accept`, `maxSize`,
    `entityType`, `fieldName`.
  - **Headless**: `EditFieldViewModel` carries those file-field metadata and
    `computeEditViewModel` copies them from the field def.
  - **renderer-web**: a `FileUploadInput` widget POSTs the picked file (multipart,
    with the `X-CSRF-Token` double-submit header) to `/api/files`, stores the
    returned FileRef id as the field value, and previews images via
    `GET /api/files/:id`.
  - **dev-server**: `runDevApp` / `createKumikoServer` gain a `files` option
    (`{ storageProvider }`) threaded to `setupTestStack` (which mounts the upload
    routes + `ctx.files`); an explicitly-wired provider now satisfies the
    `FILE_STORAGE_PROVIDER` boot gate so demos don't need the env bridge.

  The `styleguide` "Examples" feature adds a Profile screen with
  `avatar: createImageField()`; an e2e test proves the upload round-trip
  (pick → POST → preview).

- 15b06c1: Add interactive faceted filters to the auto-generated entity list — the shadcn
  data-table pattern (outline dropdown buttons with multi-select checkboxes, like
  the "Columns" toggle). Each `filterable: true` **select** or **boolean** field
  becomes a facet dropdown in the list toolbar; selecting values filters the list
  server-side and a "Reset" clears all active facets.

  Wiring across the layers:

  - **Query schema** (`defineEntityListHandler`): a new `filters?: Filter[]`
    field next to the existing static `filter?` — additive, no contract break.
    `executor.list` applies the static filter and every dynamic filter with AND
    (the `op:"in"` array path already produced correct `IN (...)` SQL).
  - **Client schema** (`buildAppSchema`): the field-level `filterable` flag is now
    serialized so the renderer knows which fields can be faceted.
  - **URL state** (`useListUrlState`): facet selections live under
    `?<screenId>.f.<field>=v1,v2` keys, page-resetting on change, with
    `setFilter` / `clearFilters`.
  - **Renderer**: `KumikoScreen` derives the facets from the entity's filterable
    select/boolean fields (labels via the existing `field` / `:option:` i18n
    convention) and builds `payload.filters` (booleans coerced from the URL
    strings). New `DataTableFacet` type + `filterFacets` / `filterValues` /
    `onFilterChange` / `onFilterReset` props on `DataTableProps`.
  - **renderer-web**: `DefaultDataTable` renders each facet as a vendored shadcn
    `DropdownMenu` of `DropdownMenuCheckboxItem`s with an active-count badge — no
    new registry primitive.

  Range filters (number/date `lt`/`gt`) are intentionally out of scope; only
  equality facets (select/boolean) are rendered.

- 32aa721: Fold the VisualTree navigation into the single shadcn NavTree — one nav, not
  two. Dynamic, runtime-extendable nav nodes now live in the same sidebar as the
  static `r.nav` entries: a node declared with `r.nav({ provider: true })` pulls
  its children lazily from a client-registered nav-provider and refreshes them
  live on entity events (SSE) — the capability the old `navigation: "tree"`
  VisualTree workspace used to provide, now available everywhere.

  **Breaking — `ClientFeatureDefinition` (renderer-web):** the `treeProvider`,
  `treeEntities` and `treeActions` fields are removed. Provide dynamic nav
  children via `navProviders` / `navEntities` (keyed on the nav QN) and editor
  components via `resolvers`, attached to an `r.nav({ provider: true })` node.

  **Breaking — VisualTree removed:** the `VisualTree` / `TreeNodeRenderer`
  components and the tree-providers context are deleted. `WorkspaceShell` always
  renders `NavTree`; a target persisted in the URL (`?t=feat:action&a_*=…`)
  renders the `EditorPanel` in the content area instead of the routed screen.
  `WorkspaceDefinition.navigation` is now a **no-op** (kept for now, deferred
  removal) — `navigation: "tree"` no longer switches the sidebar component.

  **`textContentClient` / `legalPagesClient` (bundled-features):** both now take
  an optional `{ navId }`. The consuming app owns the nav node (label, icon,
  access — same convention as `managed-pages`) by registering
  `r.nav({ id, provider: true })` in its own feature and passing that node's QN
  as `navId`; the bundled-feature supplies the children + editor. **Without
  `navId` no sidebar node is created** — apps that mount these features
  server-side only (legal routes) no longer get a stray, provider-less nav node.

  Migration for an app that used a `navigation: "tree"` workspace (e.g. an admin
  content/legal editor): register `r.nav({ provider: true })` nodes in your own
  feature with the access you want, add their QNs to the workspace's nav members,
  drop `navigation: "tree"`, and pass each node's QN as `navId` to
  `textContentClient({ navId })` / `legalPagesClient({ navId })`.

- 15b06c1: Refresh the auto-UI default to a polished shadcn "new-york" standard:

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

  - `Sidebar collapsible="icon"` + `SidebarInset`: a `SidebarBrand` team-switcher
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

### Patch Changes

- Updated dependencies [77ed9c1]
- Updated dependencies [7eacfcb]
- Updated dependencies [15b06c1]
  - @cosmicdrift/kumiko-headless@0.66.0
  - @cosmicdrift/kumiko-renderer@0.66.0
  - @cosmicdrift/kumiko-dispatcher-live@0.66.0

## 0.65.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.65.0
- @cosmicdrift/kumiko-renderer@0.65.0
- @cosmicdrift/kumiko-dispatcher-live@0.65.0

## 0.64.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.64.0
- @cosmicdrift/kumiko-renderer@0.64.0
- @cosmicdrift/kumiko-dispatcher-live@0.64.0

## 0.63.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.63.0
- @cosmicdrift/kumiko-headless@0.63.0
- @cosmicdrift/kumiko-renderer@0.63.0

## 0.62.0

### Patch Changes

- Updated dependencies [ee56d33]
  - @cosmicdrift/kumiko-headless@0.62.0
  - @cosmicdrift/kumiko-dispatcher-live@0.62.0
  - @cosmicdrift/kumiko-renderer@0.62.0

## 0.61.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.61.0
- @cosmicdrift/kumiko-headless@0.61.0
- @cosmicdrift/kumiko-renderer@0.61.0

## 0.60.4

### Patch Changes

- @cosmicdrift/kumiko-headless@0.60.4
- @cosmicdrift/kumiko-renderer@0.60.4
- @cosmicdrift/kumiko-dispatcher-live@0.60.4

## 0.60.3

### Patch Changes

- @cosmicdrift/kumiko-headless@0.60.3
- @cosmicdrift/kumiko-renderer@0.60.3
- @cosmicdrift/kumiko-dispatcher-live@0.60.3

## 0.60.2

### Patch Changes

- @cosmicdrift/kumiko-headless@0.60.2
- @cosmicdrift/kumiko-renderer@0.60.2
- @cosmicdrift/kumiko-dispatcher-live@0.60.2

## 0.60.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.60.1
- @cosmicdrift/kumiko-renderer@0.60.1
- @cosmicdrift/kumiko-dispatcher-live@0.60.1

## 0.60.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.60.0
- @cosmicdrift/kumiko-renderer@0.60.0
- @cosmicdrift/kumiko-dispatcher-live@0.60.0

## 0.59.2

### Patch Changes

- @cosmicdrift/kumiko-headless@0.59.2
- @cosmicdrift/kumiko-renderer@0.59.2
- @cosmicdrift/kumiko-dispatcher-live@0.59.2

## 0.59.1

### Patch Changes

- Updated dependencies [731d87f]
  - @cosmicdrift/kumiko-renderer@0.59.1
  - @cosmicdrift/kumiko-headless@0.59.1
  - @cosmicdrift/kumiko-dispatcher-live@0.59.1

## 0.59.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.59.0
- @cosmicdrift/kumiko-headless@0.59.0
- @cosmicdrift/kumiko-renderer@0.59.0

## 0.58.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.58.0
- @cosmicdrift/kumiko-renderer@0.58.0
- @cosmicdrift/kumiko-dispatcher-live@0.58.0

## 0.57.2

### Patch Changes

- @cosmicdrift/kumiko-headless@0.57.2
- @cosmicdrift/kumiko-renderer@0.57.2
- @cosmicdrift/kumiko-dispatcher-live@0.57.2

## 0.57.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.57.1
- @cosmicdrift/kumiko-renderer@0.57.1
- @cosmicdrift/kumiko-dispatcher-live@0.57.1

## 0.57.0

### Patch Changes

- 4c32f16: fix(config-mask): cascade-disclosure usability (#429, #430)

  #430: a config save now refetches values+cascade, so the Cascade-Disclosure
  reflects the saved value immediately instead of staying stale until reload
  (customSubmit previously only rebased the form state — onReset already refetched).

  #429: the disclosure trigger moves into the field label row (right-aligned via
  DefaultField's `flex justify-between`); the expanded detail renders between label
  and input (directly under its trigger). A field that only shows its inherited
  default is no longer expandable — no redundant single-row panel.

- Updated dependencies [4c32f16]
  - @cosmicdrift/kumiko-renderer@0.57.0
  - @cosmicdrift/kumiko-headless@0.57.0
  - @cosmicdrift/kumiko-dispatcher-live@0.57.0

## 0.56.1

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.56.1
- @cosmicdrift/kumiko-headless@0.56.1
- @cosmicdrift/kumiko-renderer@0.56.1

## 0.56.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.56.0
- @cosmicdrift/kumiko-renderer@0.56.0
- @cosmicdrift/kumiko-dispatcher-live@0.56.0

## 0.55.1

### Patch Changes

- acdc14c: fix(renderer-web): doppelter Kalender-Header im Date-/Timestamp-Picker

  react-day-picker v9 rendert im `captionLayout="dropdown"`-Modus je Monat/Jahr
  ein `<select>` UND ein begleitendes `aria-hidden`-`<span>` mit demselben Label;
  sichtbar wird nur eines, weil rdps eigene `style.css` das `<select>` transparent
  darüberlegt. Da `CalendarPopover` die rdp-Klassen mit eigenen Tokens überschreibt,
  greift diese Positionierung nicht → Monat/Jahr doppelt (Folgebug aus #369).

  Fix: rdps `Dropdown` per `components`-Prop durch ein einzelnes gestyltes `<select>`
  ersetzen — kein Begleit-Span mehr, CSS-unabhängig korrekt. Neuer Browser-e2e
  (`date-picker.spec.ts`) pinnt es (genau 2 Selects, kein aria-hidden-Label daneben,
  plus Tippen→ISO und Jahres-Sprung). Betrifft `date`- und `timestamp`-Picker
  gleichermaßen (geteilter `CalendarPopover`).

  - @cosmicdrift/kumiko-dispatcher-live@0.55.1
  - @cosmicdrift/kumiko-headless@0.55.1
  - @cosmicdrift/kumiko-renderer@0.55.1

## 0.55.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.55.0
- @cosmicdrift/kumiko-renderer@0.55.0
- @cosmicdrift/kumiko-dispatcher-live@0.55.0

## 0.54.0

### Minor Changes

- 1135437: Date/Calendar-Inputs vereinheitlicht (#369): `date` und `timestamp` teilen jetzt
  eine gemeinsame, tippbare Eingabe mit Jahres-/Dekaden-Dropdown im Kalender. Datümer
  sind überall direkt tippbar (locale-aware Parse), nicht mehr nur per Klick. Neu pro
  Feld konfigurierbar: `min`/`max` (Picker-Range + Zod-Durchsetzung beim Write) und
  `locale` (Anzeige-/Eingabe-Format) auf `date`/`timestamp`/`locatedTimestamp`-Feldern.

### Patch Changes

- Updated dependencies [1135437]
  - @cosmicdrift/kumiko-renderer@0.54.0
  - @cosmicdrift/kumiko-headless@0.54.0
  - @cosmicdrift/kumiko-dispatcher-live@0.54.0

## 0.53.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.53.0
- @cosmicdrift/kumiko-headless@0.53.0
- @cosmicdrift/kumiko-renderer@0.53.0

## 0.52.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.52.0
- @cosmicdrift/kumiko-headless@0.52.0
- @cosmicdrift/kumiko-renderer@0.52.0

## 0.51.0

### Minor Changes

- 9916c33: App-Shell: optional `fill` + Sidebar-Nav-Icons.

  - `AppLayout` und `DefaultAppShell` bekommen ein optionales `fill?: boolean`.
    `fill` → Wurzel `h-screen` (fixe Viewport-Höhe), Sidebar/Topbar bleiben
    stehen, der Main-Bereich scrollt INNEN (`min-h-0` + `overflow-auto`) statt
    der ganzen Seite. Default (`false`) bleibt der bisherige `min-h-screen`-Flow
    — bestehende Apps ändern sich nicht. Clippt nie (Content scrollt in `main`).
    Plus `className`/`mainClassName` als Erweiterungspunkte (cn-merge).
  - `NavTree` rendert jetzt Icons: ein Nav-Eintrag mit `icon: "<key>"` zeigt das
    passende lucide-Icon vor dem Label (vorher nur ein Punkt). Kuratierte
    Registry (`dashboard`, `list`, `calculator`, `wallet`, `sparkles`, …);
    unbekannte Keys fallen sauber auf den Punkt zurück (kein Boot-Fail).

### Patch Changes

- @cosmicdrift/kumiko-headless@0.51.0
- @cosmicdrift/kumiko-renderer@0.51.0
- @cosmicdrift/kumiko-dispatcher-live@0.51.0

## 0.50.0

### Patch Changes

- 0d92100: dev/prod-parity: validateBoot in dev-server + standalone-stable renderer-web @source + CSS-completeness guard (#359)

  Two prod-only breakages closed, both caused by the dev path validating/building
  differently than the prod path:

  - **Boot-validation parity**: `runDevApp` now runs the same `validateBoot` as
    `runProdApp`, before the fs-watcher and server start. Unqualified nav-/handler
    QNs, unresolvable navigate-targets and screen-access errors now fail fast in
    dev instead of only crashing the prod pod (CrashLoopBackOff).
  - **renderer-web stylesheet scans its own shell standalone**: `renderer-web/src/styles.css`
    scanned its shell classes via a monorepo-relative `@source` (`../../renderer-web/src`),
    which only resolves through the workspace symlink. A standalone consumer install
    found nothing → unstyled prod (15KB vs 48KB). It is now self-relative (`./`),
    which resolves in every install layout since the package ships `src`. Behaviour
    in the monorepo is identical (`./` ≡ the old path at the real location).
  - **Build-time CSS-completeness guard**: when `kumiko-build` falls back to the
    packaged renderer-web stylesheet, it now asserts the compiled CSS contains the
    shell sentinel class and fails loud (with a `src/styles.css` hint) instead of
    shipping an unstyled image.
  - @cosmicdrift/kumiko-headless@0.50.0
  - @cosmicdrift/kumiko-renderer@0.50.0
  - @cosmicdrift/kumiko-dispatcher-live@0.50.0

## 0.49.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.49.0
- @cosmicdrift/kumiko-renderer@0.49.0
- @cosmicdrift/kumiko-dispatcher-live@0.49.0

## 0.48.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.48.1
- @cosmicdrift/kumiko-renderer@0.48.1
- @cosmicdrift/kumiko-dispatcher-live@0.48.1

## 0.48.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.48.0
- @cosmicdrift/kumiko-renderer@0.48.0
- @cosmicdrift/kumiko-dispatcher-live@0.48.0

## 0.47.0

### Minor Changes

- f32f99d: Apex-Surface v1 — der evidente Weg für öffentlichen, schema-losen Apex-Content (Login/Register/Passwort-vergessen/Konto-löschen) in jeder Kumiko-App.

  **`@cosmicdrift/kumiko-renderer-web`: `createPublicSurface`** — das öffentliche Gegenstück zu `createKumikoApp`. Schema-LOSER Mount (`injectSchema: false`, kein `__KUMIKO_SCHEMA__`, kein Topologie-Leak), Match-once-Routing, optionaler `shell`-Wrapper. Stackt von übergebenen `clientFeatures` nur `providers` + `translations` — bewusst **nicht** deren `gates` (ein AuthGate würde die öffentliche Surface hinter Login sperren).

  **`@cosmicdrift/kumiko-bundled-features` (auth-email-password): `AuthShell`** — `AuthCard` rendert jetzt über einen optionalen `useAuthShell()`-Renderer. Default bleibt der Fullscreen-Wrapper (rückwärtskompatibel); `AuthShellProvider` lässt Apps die Auth-Card in ihrer Marketing-Chrome statt Fullscreen rendern.

  **`@cosmicdrift/kumiko-bundled-features` (user-data-rights): anonymer, email-verifizierter Deletion-Flow** — DSGVO Art. 17 greift gerade beim Lockout (User kann sich nicht mehr einloggen). Zwei neue anonyme Handler: `request-deletion-by-email` (enumeration-safe, Magic-Link) + `confirm-deletion-by-token` (idempotent, startet dieselbe Grace-Period wie der authentifizierte Pfad via geteiltem `startDeletionGracePeriod`). HMAC-Token trägt `userId` + Expiry selbst (kein DB-Table/Redis/Migration), Purpose `"deletion-request"`. Neue Options `deletionTokenSecret` / `deletionVerifyUrl` / `sendDeletionVerificationEmail` (Callback MUSS non-blocking/enqueue sein — synchroner Send öffnet ein Timing-Oracle für Account-Enumeration).

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.47.0
- @cosmicdrift/kumiko-headless@0.47.0
- @cosmicdrift/kumiko-renderer@0.47.0

## 0.46.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.46.0
- @cosmicdrift/kumiko-renderer@0.46.0
- @cosmicdrift/kumiko-dispatcher-live@0.46.0

## 0.45.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.45.1
- @cosmicdrift/kumiko-renderer@0.45.1
- @cosmicdrift/kumiko-dispatcher-live@0.45.1

## 0.45.0

### Minor Changes

- 2764993: Bug-Bash 3 Wave L — Renderer- + Bundled-Features-Verbesserungen:

  - **DataTable `rowActionMode="inline"`** (#8/#9): neues Prop, das Row-Actions
    immer als linksbündige Inline-Buttons rendert (auch bei >2 Actions, kein
    Kebab) — einheitliche, ausgerichtete Optik über alle Listen. Default bleibt
    `"adaptive"` (bisheriges Verhalten).
  - **Config-Default-Wording** (#11): Cascade-Disclosure nutzt denselben Begriff
    „Standard"/„Default" wie das Feld-Label-Badge (statt „Vorgabe"/„Preset") —
    ein durchgängiger Begriff. Der Key `kumiko.config.cascade.preset` entfällt.
  - **`slots.header`-Placement** (#12): der List-Header-Slot (z.B. Cap-Counter)
    rendert jetzt in der Listen-Toolbar statt als loser Text über dem Screen-Titel.
  - **Composed Extension-Save** (#1): neuer `useExtensionFormSubmit`-Mechanismus —
    Extension-Sections (z.B. Custom-Fields) schreiben beim Haupt-Form-Submit mit,
    statt einen eigenen Save-Button zu führen. Der Haupt-Save aktiviert sich auch
    bei reiner Section-Änderung.
  - **Profil-Seite** (#3): Sektionen als abgegrenzte Karten, Danger-Zone hervorgehoben.

### Patch Changes

- Updated dependencies [2764993]
  - @cosmicdrift/kumiko-renderer@0.45.0
  - @cosmicdrift/kumiko-dispatcher-live@0.45.0
  - @cosmicdrift/kumiko-headless@0.45.0

## 0.44.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.44.0
- @cosmicdrift/kumiko-renderer@0.44.0
- @cosmicdrift/kumiko-dispatcher-live@0.44.0

## 0.43.0

### Patch Changes

- Updated dependencies [5b04c40]
  - @cosmicdrift/kumiko-renderer@0.43.0
  - @cosmicdrift/kumiko-dispatcher-live@0.43.0
  - @cosmicdrift/kumiko-headless@0.43.0

## 0.42.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.42.0
- @cosmicdrift/kumiko-headless@0.42.0
- @cosmicdrift/kumiko-renderer@0.42.0

## 0.41.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.41.1
- @cosmicdrift/kumiko-renderer@0.41.1
- @cosmicdrift/kumiko-dispatcher-live@0.41.1

## 0.41.0

### Patch Changes

- Updated dependencies [3f2d6ee]
  - @cosmicdrift/kumiko-renderer@0.41.0
  - @cosmicdrift/kumiko-headless@0.41.0
  - @cosmicdrift/kumiko-dispatcher-live@0.41.0

## 0.40.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.40.1
- @cosmicdrift/kumiko-renderer@0.40.1
- @cosmicdrift/kumiko-dispatcher-live@0.40.1

## 0.40.0

### Minor Changes

- 64a51ac: Review-Findings Rest-Welle (PR #323, 35 Findings). Verhaltens-relevant:

  - **Boot strenger** (kann bisher durchlaufende Boots brechen): required
    Config-Keys mit computed bzw. non-empty default sind jetzt Boot-Fehler;
    Action-Field-Refs (pick/map/visible.field/entityId) werden gegen die
    Entity-Felder validiert; zwei Entities mit gleichem tableName werfen.
  - **readiness:** SystemAdmin-gated required-Keys zählen jetzt im Verdict
    jedes Callers (skipAccessFilter im Rollup) — `ready` kann von true auf
    false kippen, wo vorher Lücken unsichtbar waren; mail-foundation
    Provider-Key ist required.
  - **access.admin-Preset** enthält zusätzlich `TenantAdmin`.
  - **user-data-rights:** runForgetCleanup wählt savepoint-FIRST — nested
    BEGIN in Transaktionen (Prod-Incident-Klasse) behoben.
  - **dev-server:** `extraRoutes`-deps zwischen runProdApp und
    createKumikoServer geteilt (`ExtraRoutesSystemDeps`); createKumikoServer
    reicht jetzt den nackten ioredis-Client statt des TestRedis-Wrappers.
  - **renderer-web:** Theme-Restore concurrent-render-sicher (useState-Lazy);
    ConfigSourceBadge kollabiert Operator-Quellen auf Tenant-Screens.
  - **renderer/headless:** evalFieldCondition als Single-Source re-exportiert.

### Patch Changes

- Updated dependencies [64a51ac]
  - @cosmicdrift/kumiko-renderer@0.40.0
  - @cosmicdrift/kumiko-headless@0.40.0
  - @cosmicdrift/kumiko-dispatcher-live@0.40.0

## 0.39.0

### Minor Changes

- 34cb1f7: Bug-Bash-2 Wave F2: Renderer-Fixes + Auth-Vorarbeit

  - Settings-Screens: "Vorgabe"-Block (Source-Badge + Cascade-Disclosure)
    erschien doppelt pro Feld — RenderEdit reichte denselben Callback als
    labelAppendix UND fieldAppendix durch. Jetzt zwei getrennte Callbacks.
  - timestamp-Felder: neues TimestampInput konvertiert zwischen lokaler
    Wall-Clock (datetime-local) und UTC-Instant mit `Z` — Saves endeten
    vorher in 422 invalid_format. locatedTimestamps bleiben Wall-Clock
    (neues wallClock-Flag im EditFieldViewModel/FieldInputProps).
  - Validierungsfehler: errors.validation.\*-Keys (Zod-4-Codes +
    Framework-Codes) in den de/en-Default-Bundles, Field interpoliert
    issue.params ({minimum} etc.) — vorher rohe Keys in der UI.
  - AuthRoutesConfig.cookieDomain: Domain-Attribut für beide Auth-Cookies
    (Cross-Subdomain-Login), Logout löscht Domain- und host-only-Variante.
    Pass-through via RunProdApp/RunDevApp-Auth-Options.
  - HostDispatchFn bekommt `search` (Query-String) für verlustfreie
    Host-Redirects (additiv).

### Patch Changes

- Updated dependencies [34cb1f7]
  - @cosmicdrift/kumiko-renderer@0.39.0
  - @cosmicdrift/kumiko-headless@0.39.0
  - @cosmicdrift/kumiko-dispatcher-live@0.39.0

## 0.38.0

### Patch Changes

- ffcce8a: Review-findings quick-win sweep (29 findings across 24 PR reviews):

  - framework: `asEntityTableMeta` removed from the `bun-db` barrel (import via `db/query` shim instead — minor because it drops a public export); `toStoredEvent` now exported from the `event-store` barrel; `EventRow.tenantId` typed as `TenantId`; fallback-logger format unified to `[ns] msg` on both paths; search-payload collision warning deduped per entity:key and no longer mislabels contributor-vs-contributor collisions as Stammfield overwrites; `extractTableName` calls in projection-table-index carry an identifying context; `isFormatSpec` without cast; FieldFormatRegistry augmentation example uses the real `engine/types` subpath (verified compiling).
  - dev-server: shared `isKebabSegment` replaces three copies of `KEBAB_RE`; `dispatchSystemWrite` roles use the `ROLES` constant.
  - bundled-features: `isFileProviderPlugin` type guard exported from file-foundation and used instead of the blind cast (provider registration without `build()` now fails with a descriptive error); `enforceStockCap` JSDoc documents the TOCTOU caveat; assorted dead code and stale/misleading comments fixed.
  - headless: applyFormatSpec dev-warning in English.
  - docs: all `*.integration.ts` references corrected to `*.integration.test.ts`; use-all-bundled feature-manifest generation sorts configKeys/secrets deterministically (manifest regenerated).

- Updated dependencies [0f093f1]
- Updated dependencies [ffcce8a]
  - @cosmicdrift/kumiko-headless@0.38.0
  - @cosmicdrift/kumiko-renderer@0.38.0
  - @cosmicdrift/kumiko-dispatcher-live@0.38.0

## 0.37.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.37.0
- @cosmicdrift/kumiko-headless@0.37.0
- @cosmicdrift/kumiko-renderer@0.37.0

## 0.36.0

### Patch Changes

- d84a515: FormatSpec-Verbesserungen: isFormatSpec-TypeGuard, timestamp/date Locale-Optionen, applyFormatSpec nach headless verschoben, normalizeListColumn dev-warning für Funktions-Renderer, buildAppSchema dev-assertion für JSON-Safety
- 1901bdf: applyFormatSpec: dev-warning für unbekannte Format-Keys (console.warn in !production); JSON-round-trip-Tests für FormatSpec-Renderer und FieldCondition-RowActions
- Updated dependencies [d84a515]
  - @cosmicdrift/kumiko-headless@0.36.0
  - @cosmicdrift/kumiko-renderer@0.36.0
  - @cosmicdrift/kumiko-dispatcher-live@0.36.0

## 0.35.0

### Minor Changes

- 6553405: feat(screen-types): FieldFormatRegistry + FormatSpec ersetzen function-Renderer

  `FieldRenderer` akzeptiert keine Inline-Funktionen mehr — sie wurden von
  `JSON.stringify` in der `buildAppSchema → window.__KUMIKO_SCHEMA__`-Pipeline
  still gedroppt, was zu unsichtbaren Render-Fehlern führte.

  Neu: `FormatSpec` — deklarativer, JSON-sicherer Formatter-Typ:
  `{ format: "timestamp" }` | `{ format: "currency", symbol: "€" }` |
  `{ format: "boolean", trueLabel: "Ja", falseLabel: "Nein" }` |
  `{ format: "priority", prefix: "P" }` | `{ format: "date" }`

  Apps erweitern das Built-in-Set per module augmentation:

  ```ts
  declare module "@cosmicdrift/kumiko-framework" {
    interface FieldFormatRegistry {
      myFormat: { myOption?: string };
    }
  }
  ```

  `renderer-web` kennt alle Built-in-Keys; unbekannte App-spezifische Keys
  fallen auf `String(value)` zurück.

  Migration: Inline-Funktionen durch das passende `{ format: "..." }` ersetzen.

### Patch Changes

- @cosmicdrift/kumiko-headless@0.35.0
- @cosmicdrift/kumiko-renderer@0.35.0
- @cosmicdrift/kumiko-dispatcher-live@0.35.0

## 0.34.2

### Patch Changes

- Updated dependencies [ce4a16f]
  - @cosmicdrift/kumiko-renderer@0.34.2
  - @cosmicdrift/kumiko-dispatcher-live@0.34.2
  - @cosmicdrift/kumiko-headless@0.34.2

## 0.34.1

### Patch Changes

- Updated dependencies [689133c]
  - @cosmicdrift/kumiko-renderer@0.34.1
  - @cosmicdrift/kumiko-dispatcher-live@0.34.1
  - @cosmicdrift/kumiko-headless@0.34.1

## 0.34.0

### Patch Changes

- Updated dependencies [9be544f]
  - @cosmicdrift/kumiko-headless@0.34.0
  - @cosmicdrift/kumiko-renderer@0.34.0
  - @cosmicdrift/kumiko-dispatcher-live@0.34.0

## 0.33.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.33.0
- @cosmicdrift/kumiko-headless@0.33.0
- @cosmicdrift/kumiko-renderer@0.33.0

## 0.32.1

### Patch Changes

- Updated dependencies [b418259]
  - @cosmicdrift/kumiko-renderer@0.32.1
  - @cosmicdrift/kumiko-dispatcher-live@0.32.1
  - @cosmicdrift/kumiko-headless@0.32.1

## 0.32.0

### Minor Changes

- 5bb198b: ConfigCascadeView übersetzt + scope-gefiltert

  - Source-Badges und Cascade-Texte zeigten rohe i18n-Keys
    (`config.source.default` …) — die Keys existierten in keinem Bundle.
    Jetzt `kumiko.config.source.*` / `kumiko.config.cascade.*` mit de/en-
    Defaults in `kumikoDefaultTranslations`; `ConfigSourceBadge` nutzt
    dieselben Keys statt hartkodiertem Englisch.
  - Nicht-System-Screens zeigen nur noch die eigene Cascade-Ebene plus
    EINE neutrale „Vorgabe"-Zeile (effektiver Wert) — System/App-Override/
    Computed sind Operator-Interna und für Tenant-/User-Scope unsichtbar.
    `screenScope="system"` behält die Vollsicht.

- 05c4447: Workspace-Navigation + Row-Action-Fehler sichtbar machen

  - `useBrowserNavApi` honoriert jetzt den dokumentierten NavTarget-Contract:
    `workspaceId` weglassen = aktueller Workspace bleibt. Vorher erzeugte
    `navigate({ screenId })` im Workspace-Mode einen Pfad ohne Workspace-
    Prefix, `parsePath` las das Screen-Segment als Workspace-Id und
    `WorkspaceShell` revertete sofort auf den Default-Screen — Edit-/
    Toolbar-Navigate-Aktionen wirkten tot.
  - `RowActionNavigate` hat ein neues optionales `entityId(row)`:
    entityEdit-Targets bekommen die Id als Pfad-Segment (`route.entityId`),
    `?id=`-Search-Params öffneten den Edit-Screen im Create-Mode.
  - navigate-Row-Actions setzen Search-Params jetzt NACH `nav.navigate`
    (pushState trägt keine Query — vorher gesetzte Params klebten an der
    alten URL, actionForm-Prefill kam leer an).
  - Row-Action-Writes verwerfen Failure-Results nicht mehr:
    `WriteFailedError` (neu exportiert, inkl. `dispatcherErrorText`) wird
    geworfen und im Web-Renderer als destructive Toast gezeigt (inkl.
    docsUrl). Vorher schloss der Confirm-Dialog kommentarlos — "Klick tut
    nichts". Confirm-Dialoge schließen außerdem auch bei rejected
    onConfirm statt offen zu hängen.

- 0009486: Theme-Persistenz, cancelTarget für actionForms, Login-Legal-Links

  - Theme-Wahl wird in localStorage persistiert (`kumiko:theme`) und beim
    ersten Mount restored (`applyStoredThemeMode` + `THEME_STORAGE_KEY`
    exportiert) — vorher war der Dark/Light-Toggle nach jedem Reload weg.
    FOUC-Schutz: Inline-Script-Snippet siehe tokens.ts-Header.
  - `ActionFormScreenDefinition.cancelTarget?: string | false`: entkoppelt
    den Abbrechen-Button vom Submit-`redirect`; `false` entfernt ihn
    (Single-Action-Screens wie „Test-Mail senden"). Boot-Validator prüft
    String-Targets wie `redirect`.
  - `LoginScreen` bekommt `legalLinks` (Impressum/Datenschutz unterhalb
    der Card) — der Login ist oft die einzige öffentliche Seite einer
    Admin-Domain und braucht erreichbare Legal-Links (Impressumspflicht).

### Patch Changes

- Updated dependencies [5bb198b]
- Updated dependencies [05c4447]
- Updated dependencies [0009486]
  - @cosmicdrift/kumiko-renderer@0.32.0
  - @cosmicdrift/kumiko-headless@0.32.0
  - @cosmicdrift/kumiko-dispatcher-live@0.32.0

## 0.31.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.31.1
- @cosmicdrift/kumiko-renderer@0.31.1
- @cosmicdrift/kumiko-dispatcher-live@0.31.1

## 0.31.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.31.0
- @cosmicdrift/kumiko-renderer@0.31.0
- @cosmicdrift/kumiko-dispatcher-live@0.31.0

## 0.30.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.30.0
- @cosmicdrift/kumiko-renderer@0.30.0
- @cosmicdrift/kumiko-dispatcher-live@0.30.0

## 0.29.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.29.0
- @cosmicdrift/kumiko-renderer@0.29.0
- @cosmicdrift/kumiko-dispatcher-live@0.29.0

## 0.28.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.28.0
- @cosmicdrift/kumiko-renderer@0.28.0
- @cosmicdrift/kumiko-dispatcher-live@0.28.0

## 0.27.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.27.0
- @cosmicdrift/kumiko-renderer@0.27.0
- @cosmicdrift/kumiko-dispatcher-live@0.27.0

## 0.26.0

### Patch Changes

- de348c6: fix(pagination): `computeVisiblePages` keeps 5 page numbers visible at the list edges (sliding the window instead of clamping it) — e.g. `p=1/20` now shows `1 2 3 4 5 … 20` instead of `1 2 3 … 20`, matching the documented behaviour. Mid-list rendering is unchanged.
- 4e68aff: test(primitives): export pure helpers for unit testing — `computeVisiblePages`, `defaultCellRender`, `isComponentRendererRef` (index.tsx) and `parseIso`/`toIso` (date-input). No behaviour change; mirrors money-input which already exports its pure logic.
- Updated dependencies [4911a41]
  - @cosmicdrift/kumiko-renderer@0.26.0
  - @cosmicdrift/kumiko-dispatcher-live@0.26.0
  - @cosmicdrift/kumiko-headless@0.26.0

## 0.25.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.25.0
- @cosmicdrift/kumiko-renderer@0.25.0
- @cosmicdrift/kumiko-dispatcher-live@0.25.0

## 0.24.1

### Patch Changes

- Updated dependencies [52cd396]
  - @cosmicdrift/kumiko-renderer@0.24.1
  - @cosmicdrift/kumiko-headless@0.24.1
  - @cosmicdrift/kumiko-dispatcher-live@0.24.1

## 0.24.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.24.0
- @cosmicdrift/kumiko-renderer@0.24.0
- @cosmicdrift/kumiko-dispatcher-live@0.24.0

## 0.23.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.23.1
- @cosmicdrift/kumiko-renderer@0.23.1
- @cosmicdrift/kumiko-dispatcher-live@0.23.1

## 0.23.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.23.0
- @cosmicdrift/kumiko-renderer@0.23.0
- @cosmicdrift/kumiko-dispatcher-live@0.23.0

## 0.22.0

### Minor Changes

- dcc8d4c: `ExtensionSectionsProvider` + `useExtensionSectionComponent(name)`-Hook für client-side Component-Auflösung im entityEdit-Screen via `__component`-Marker. Apps registrieren Components über das neue `ClientFeatureDefinition.extensionSectionComponents`-Feld (Pattern analog zu `columnRenderers`, Last-Wins-Semantik bei Multi-Feature-Kollision). `createKumikoApp` aggregiert + mountet den Provider automatisch. RenderEdit mountet die aufgelöste Component mit `{ entityName, entityId }`; fehlt die Registrierung → Banner mit dem gesuchten Component-Namen.

### Patch Changes

- Updated dependencies [dcc8d4c]
- Updated dependencies [dcc8d4c]
  - @cosmicdrift/kumiko-headless@0.22.0
  - @cosmicdrift/kumiko-renderer@0.22.0
  - @cosmicdrift/kumiko-dispatcher-live@0.22.0

## 0.21.1

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.21.1
- @cosmicdrift/kumiko-headless@0.21.1
- @cosmicdrift/kumiko-renderer@0.21.1

## 0.21.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.21.0
- @cosmicdrift/kumiko-renderer@0.21.0
- @cosmicdrift/kumiko-dispatcher-live@0.21.0

## 0.20.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.20.0
- @cosmicdrift/kumiko-renderer@0.20.0
- @cosmicdrift/kumiko-dispatcher-live@0.20.0

## 0.19.1

### Patch Changes

- a146fc4: Add shared boot-seed contract (`SeedIfExists`, `runEventStoreSeed`) and default skip-if-exists for `seedTextBlock` / `seedComplianceProfile`.
- Updated dependencies [a146fc4]
  - @cosmicdrift/kumiko-dispatcher-live@0.19.1
  - @cosmicdrift/kumiko-headless@0.19.1
  - @cosmicdrift/kumiko-renderer@0.19.1

## 0.19.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.19.0
- @cosmicdrift/kumiko-renderer@0.19.0
- @cosmicdrift/kumiko-dispatcher-live@0.19.0

## 0.18.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.18.0
- @cosmicdrift/kumiko-renderer@0.18.0
- @cosmicdrift/kumiko-dispatcher-live@0.18.0

## 0.17.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.17.0
- @cosmicdrift/kumiko-renderer@0.17.0
- @cosmicdrift/kumiko-dispatcher-live@0.17.0

## 0.16.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.16.0
- @cosmicdrift/kumiko-renderer@0.16.0
- @cosmicdrift/kumiko-dispatcher-live@0.16.0

## 0.15.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.15.0
- @cosmicdrift/kumiko-renderer@0.15.0
- @cosmicdrift/kumiko-dispatcher-live@0.15.0

## 0.14.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.14.0
- @cosmicdrift/kumiko-headless@0.14.0
- @cosmicdrift/kumiko-renderer@0.14.0

## 0.13.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.13.0
- @cosmicdrift/kumiko-renderer@0.13.0
- @cosmicdrift/kumiko-dispatcher-live@0.13.0

## 0.12.2

### Patch Changes

- @cosmicdrift/kumiko-headless@0.12.2
- @cosmicdrift/kumiko-renderer@0.12.2
- @cosmicdrift/kumiko-dispatcher-live@0.12.2

## 0.12.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.12.1
- @cosmicdrift/kumiko-renderer@0.12.1
- @cosmicdrift/kumiko-dispatcher-live@0.12.1

## 0.12.0

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.12.0
- @cosmicdrift/kumiko-headless@0.12.0
- @cosmicdrift/kumiko-renderer@0.12.0

## 0.11.2

### Patch Changes

- @cosmicdrift/kumiko-headless@0.11.2
- @cosmicdrift/kumiko-renderer@0.11.2
- @cosmicdrift/kumiko-dispatcher-live@0.11.2

## 0.11.1

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.11.1
- @cosmicdrift/kumiko-headless@0.11.1
- @cosmicdrift/kumiko-renderer@0.11.1

## 0.11.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.11.0
- @cosmicdrift/kumiko-renderer@0.11.0
- @cosmicdrift/kumiko-dispatcher-live@0.11.0

## 0.10.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.10.0
- @cosmicdrift/kumiko-renderer@0.10.0
- @cosmicdrift/kumiko-dispatcher-live@0.10.0

## 0.9.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.9.0
- @cosmicdrift/kumiko-renderer@0.9.0
- @cosmicdrift/kumiko-dispatcher-live@0.9.0

## 0.8.1

### Patch Changes

- @cosmicdrift/kumiko-headless@0.8.1
- @cosmicdrift/kumiko-renderer@0.8.1
- @cosmicdrift/kumiko-dispatcher-live@0.8.1

## 0.8.0

### Patch Changes

- @cosmicdrift/kumiko-headless@0.8.0
- @cosmicdrift/kumiko-renderer@0.8.0
- @cosmicdrift/kumiko-dispatcher-live@0.8.0

## 0.7.0

### Minor Changes

- bcf43b6: es-ops: `SeedMembershipRow` exposes `streamTenantId` (stream-tenant aus `kumiko_events.v1`) neben dem payload-`tenantId`. Seed-Authors müssen den `kumiko_events`-JOIN nicht mehr selbst bauen — `m.streamTenantId` ist der korrekte Wert für `systemWriteAs`'s `tenantIdOverride` wenn das Aggregate von einem fremden Executor angelegt wurde (typisches `seedTenantMembership(by=systemAdmin)`-Pattern).

### Patch Changes

- Updated dependencies [bcf43b6]
  - @cosmicdrift/kumiko-dispatcher-live@0.7.0
  - @cosmicdrift/kumiko-headless@0.7.0
  - @cosmicdrift/kumiko-renderer@0.7.0

## 0.6.0

### Minor Changes

- 8489d18: feat(es-ops): Phase 1.5 — tenantIdOverride + dry-run-validator + E2E-Test + Doku

  Phase 1.5 schließt die Lücken aus Phase 1 die den ersten Driver-Use-Case
  (publicstatus admin-roles) blockten. Siehe Retro:
  `kumiko-platform/docs/plans/features/es-ops-phase1-retro.md` (PR #9).

  **A1 — tenantIdOverride:**
  `SeedMigrationContext.systemWriteAs(qn, payload, tenantIdOverride?)`.
  Default SYSTEM_TENANT_ID (unverändert für System-scope-Aggregates wie
  config-values). Mit override: `createSystemUser(tenantIdOverride)` als
  Executor, damit der Event-Store-Executor den Aggregate-Stream im
  richtigen Tenant findet. Fix für die `version_conflict`-Klasse-Bug
  (Memory `feedback_event_store_tenant_consistency.md`).

  **A2 — dry-run-validator:**
  Runner parsed seed-files vor `migration.run()` per regex
  `systemWriteAs\(["']([^"']+)["']`, sammelt handler-QNs, validiert
  gegen `registry.getWriteHandler(qn)`. Fail-fast mit klarer Message

  - Datei + QN statt zur Runtime "handler not found". Catched camelCase-
    typos (kebab-case-vs-camelCase Drift) + andere QN-Drift zur Boot-Zeit.
    runProdApp reicht den richtigen Registry rein (`registry` neu in
    RunPendingSeedMigrationsArgs).

  **A3 — E2E-Test:**
  `packages/bundled-features/src/__tests__/es-ops-e2e.integration.ts`
  mit `setupTestStack`-Pattern: tenant+config Features echt geladen,
  echtes Membership-Aggregate via TenantHandlers.addMember im Demo-Tenant,
  seed-migration ruft update-member-roles mit tenantIdOverride → write
  geht durch, Marker landed, Event in Store, Read-Model aktualisiert.
  Plus typo-Test: seed mit camelCase fail-t Dry-Run mit
  `/dry-run found.*unknown handler-QN/`. **TDD-First**: ohne A1+A2 wäre
  der test rot.

  **A4 — Doku:**
  `framework/src/es-ops/README.md` erweitert um „Wann brauche ich
  tenantIdOverride?" + „Deployment-Anforderungen" (Docker COPY, Idempotenz,
  Multi-Replica) + „Lokaler Smoke vor Push". Recipe-README + seed-files
  auf neue API aktualisiert.

  **A5 — Smoke-Skript-Template:**
  `samples/recipes/seed-migration/scripts/smoke.ts` als copy-paste-Template
  für App-Authors: Bun-runnable, offline (read-only, kein DB-Write),
  validiert Module-Load + QN-Resolution + System-User-Access. Recipe-
  README dokumentiert Pflicht-Pattern.

  **Bonus-Fix:**
  `tenant:write:create`-access auf `["system", "SystemAdmin"]` erweitert
  (symmetrisch zu update-member-roles). Aufgedeckt durch Recipe-Smoke +
  initial-tenants-Seed. Pinning-Test in `tenant.integration.ts` updated.

  **Test-State:** 45/45 grün (Pre-Push). Typecheck clean. Biome clean.
  as-cast-Audit clean. Guard-silent-skip clean. Recipe-Smoke clean.

  **Folge-Step (separater PR):** publicstatus driver-sample reaktivieren
  mit lokalem Pre-Push-Smoke gegen publicstatus' echtes Feature-Set.

### Patch Changes

- Updated dependencies [8489d18]
  - @cosmicdrift/kumiko-dispatcher-live@0.6.0
  - @cosmicdrift/kumiko-headless@0.6.0
  - @cosmicdrift/kumiko-renderer@0.6.0

## 0.5.2

### Patch Changes

- 4f0d781: fix(tenant): updateMemberRoles erlaubt "system"-Rolle (symmetrisch zu create)

  Drift innerhalb des tenant-Features: `tenant:write:create` akzeptierte
  `["system", "SystemAdmin"]`, `tenant:write:update-member-roles` aber
  nur `["SystemAdmin"]`. Konsequenz: ops-tooling und seed-migrations
  (`createSystemUser` mit `roles: ["system"]`) konnten den Handler nicht
  aufrufen — `access_denied`.

  Live entdeckt beim ersten Driver-Sample der es-ops Phase 1: publicstatus
  seed `2026-05-20-fix-admin-roles.ts` rief `update-member-roles` via
  `systemWriteAs` → access_denied → Pod CrashLoopBackOff.

  Plus access-rule-Pinning-Test in `tenant.integration.ts`-scenario-7.

- Updated dependencies [4f0d781]
  - @cosmicdrift/kumiko-dispatcher-live@0.5.2
  - @cosmicdrift/kumiko-headless@0.5.2
  - @cosmicdrift/kumiko-renderer@0.5.2

## 0.5.1

### Patch Changes

- 0e00015: fix(es-ops): path.resolve statt path.join für seedsDir → seed-files

  Bun's `await import()` braucht absolute Pfade. Wenn der App-Author
  `runProdApp({ seedsDir: "./seeds" })` setzt (relativ), würde
  `path.join("./seeds", "foo.ts")` einen relativen Pfad liefern → Bun's
  Import-Resolver such relativ zum `runner.ts`-Modul (nicht zum
  `process.cwd()`) → `Cannot find module 'seeds/...' from '<runner-path>'`.

  `path.resolve` löst gegen `process.cwd()` auf → absolute Pfade →
  Import funktioniert. Aufgedeckt beim ersten Live-Boot der publicstatus-
  Driver-Migration (Pod CrashLoopBackOff).

- Updated dependencies [0e00015]
  - @cosmicdrift/kumiko-dispatcher-live@0.5.1
  - @cosmicdrift/kumiko-headless@0.5.1
  - @cosmicdrift/kumiko-renderer@0.5.1

## 0.5.0

### Minor Changes

- 7ff69ab: feat(es-ops): Phase 1 — file-based seed-migrations

  Neues first-class Operations-Pattern fürs Framework. Liefert `seed-migrations`
  als drizzle-migrate-equivalent für Event-Sourcing-Aggregate-Updates die
  idempotent-Seeder nicht erfassen können (z.B. „Member hat schon eine
  Rolle, aber jetzt soll noch eine dazukommen").

  Public-API:

  - `runProdApp({ seedsDir })` — Auto-apply pending Migrations beim Boot
  - `SeedMigration`-Interface (default-Export einer `seeds/<id>.ts`-File)
  - `SeedMigrationContext` mit `systemWriteAs` (ruft existing write-handler
    als System-User) + Read-Helpers (`findUserByEmail`,
    `findMembershipsOfUser`, `findTenants`)
  - CLI: `bunx kumiko ops seed:new|status|apply`
  - Tracking-Table `kumiko_es_operations` mit `operation_type`-Discriminator
    (vorbereitet auf Phase 2+ Operations: projection-rebuild, event-replay,
    stream-migration, ...)
  - Env-Flags: `KUMIKO_SKIP_ES_OPS=1` (alle skippen für Recovery),
    `KUMIKO_SKIP_ES_OPS_<ID>=1` (einzelne kaputte skippen)

  Garantien: single-run via tracking, atomic via per-migration-Tx,
  chronological order via filename-prefix, fail-stop bei Failure (kein
  Partial-Apply), ES-konform via Handler-Dispatch.

  Sub-path-Export: `@cosmicdrift/kumiko-framework/es-ops`

  Plan-Doc: `kumiko-platform/docs/plans/features/es-ops.md`
  Recipe: `samples/recipes/seed-migration/`
  Driver-Use-Case: publicstatus admin-roles-drift (parallel-Branch
  `feat/es-ops-driver-admin-roles`).

  Phase 2+ skizziert + offen markiert — Implementation pro Use-Case.

### Patch Changes

- Updated dependencies [7ff69ab]
  - @cosmicdrift/kumiko-dispatcher-live@0.5.0
  - @cosmicdrift/kumiko-headless@0.5.0
  - @cosmicdrift/kumiko-renderer@0.5.0

## 0.4.1

### Patch Changes

- 010b410: feat(auth-email-password): "Bestätigungs-Mail erneut senden" im LoginScreen

  LoginScreen bietet bei reason=email_not_verified jetzt einen Resend-Link
  im Fehler-Banner — der existierende `requestEmailVerification`-Endpoint
  wird direkt aufgerufen, der Banner wechselt nach Erfolg zum Info-Variant
  ("Wir haben dir eine neue Bestätigungs-Mail geschickt.").

  UX-Details:

  - Bei 429 → inline-Hint "Bitte warte kurz und versuche es erneut."
  - Bei Netzwerk/sonstigen Fehlern → inline-Hint "Konnte nicht senden."
  - Anti-Typo-Gate: ändert der User die Email-Eingabe nach dem Login-Fail,
    verschwindet der Resend-Link — sonst würde Resend silent-success an die
    geänderte (potentiell typoed) Adresse gehen ohne User-Feedback.
  - Andere Failure-Codes (invalid_credentials etc.) zeigen weiterhin keinen
    Resend-Link.

  i18n: 4 neue Keys (DE+EN) im `auth.login.resend*`-Namespace, additive.
  Apps die ihre Translations override-en müssen nichts ändern.

  Additive UI-Feature — keine API-Breaks, keine Schema-Migration.

- Updated dependencies [010b410]
  - @cosmicdrift/kumiko-dispatcher-live@0.4.1
  - @cosmicdrift/kumiko-headless@0.4.1
  - @cosmicdrift/kumiko-renderer@0.4.1

## 0.4.0

### Minor Changes

- 825e7d2: Visual-Tree V.1.4 → V.1.6 — Feature-complete Editor + Folder-Hierarchy + Roving-tabindex.

  **V.1.4** — explicit `folder?: string` Schema-Field auf text-block-entity. Slug bleibt
  kebab-only validiert, Folder explizit gesetzt. Tree gruppiert via `groupBlocksByFolder`
  (ersetzt `groupBlocksBySlugPrefix`). `Subscribe<T>` Signature um optional `emitError`
  erweitert für explicit async-error-Pfade. ProviderBranch zeigt Error-Banner mit
  Retry-Button. Drift-Test pinnt seedTextBlock-vs-set.write Slug-Validation.

  **V.1.4b** — URL-State-Routing für Editor-Target via `nav.searchParams`. F5 + Back-Button
  stellen den Editor-State wieder her. Format: `?t=text-content:edit&a_slug=...&a_lang=...`.
  Plus `useDispatchTarget` hook ersetzt globalen `dispatchTarget` als empfohlenen Production-
  Pfad (legacy bleibt für Test-Hooks).

  **V.1.5** — Arrow-Key-Navigation (`<aside role="tree">`, ARIA-tree-Pattern) + SSE-driven
  Tree-Refresh. `ClientFeatureDefinition.treeEntities?: string[]` listet Entity-Namen pro
  Provider; live-events triggern provider-re-mount → Stale-Tree-state="stub"→"filled"
  flippt nach save automatisch.

  **V.1.5c+d** — Active-Node-Highlight (explicit blue + 2px border-l + scrollIntoView),
  VS-Code-Polish (compact spacing, focus-visible, folder-icon-color text-amber, indent-
  guides per ancestor-depth), Folder-Wrapper für legal-pages ("📁 Legal" + slug-first
  Verschachtelung) und text-content ("📁 Content").

  **V.1.6** — Multi-level Folder-Splitting (`folder="page/marketing"` → nested folders,
  walk-or-create-pattern, folder/leaf-collision-tolerant). Roving-tabindex (nur focused-
  treeitem hat tabIndex=0, Tab cyclt aus dem Tree raus).

  35/35 kumiko check PASS, 13/13 group-blocks + 22/22 text-content integration tests grün.
  Browser + Keyboard lokal validated.

  **Breaking**: `TreeContext` Type entfernt (V.1.2 SR2-Rip — war nie genutzt). Provider sind
  session-bound: `TreeChildrenSubscribe = () => Subscribe<T>` statt `(ctx) => Subscribe<T>`.

  **V.1.7-Followups**: useEffect-deps in VisualTree-focus-init (Performance), Cancellation-
  Token in TreeProvider's fetch (emit-after-unmount-warning), inline-rename, drag-drop,
  file-icons per slug-extension, parent-jump bei ArrowLeft auf collapsed-item.

### Patch Changes

- Updated dependencies [825e7d2]
  - @cosmicdrift/kumiko-dispatcher-live@0.4.0
  - @cosmicdrift/kumiko-headless@0.4.0
  - @cosmicdrift/kumiko-renderer@0.4.0

## 0.3.0

### Minor Changes

- 0.3.0 bringt zwei neue Subsysteme (Step-Engine Tier-3 + Visual-Tree) plus
  eine AST-Codemod-Pipeline als Vorarbeit für den L2-AI-Layer.

  ### Breaking Changes

  - `skipTransitionGuard` → `unsafeSkipTransitionGuard` (Rename in
    feature-ast + engine). Der `unsafe`-Prefix macht die Tragweite des
    Casts sichtbar und ist konsistent zur `unsafeProjectionUpsert`- und
    `r.rawTable`-Konvention. Migration: 1:1-Ersetzung, keine Verhaltens-Änderung.

  ### Features

  - **Step-Engine M.4 — Tier-3 Workflow-Engine.** Neue Step-Vocabulary
    `wait`, `waitForEvent`, `retry` ermöglicht persistierte Long-Running-Flows
    über Job-Boundaries hinweg. Q7 Snapshot-at-Start hängt jedem Step-Run
    einen SHA-256-Fingerprint des Aggregat-Zustands an, sodass Replays
    deterministisch gegen den ursprünglichen Eingangszustand laufen.
  - **Visual-Tree V.1.x — Tree-API + Editor-Panel.** Neue `VisualTree`-
    Component plus TreeProvider-Pattern; erste TreeProviders für
    `text-content` und `legal-pages` (CMS-light + Impressum/Privacy).
    Fundament für den späteren No-Code-Designer (~3000 LOC, 98 Tests).
  - **Codemod-Pipeline.** AST-basierte Patcher-Module für strukturelle
    Feature-Edits — wird vom kommenden L2-AI-Layer als Tool-Surface
    verwendet, ist aber eigenständig nutzbar für ts-morph-style Migrationen.
  - **user-data-rights Sample-Recipe.** DSGVO Art. 15/17/18/20 vollständig
    als Sample-Recipe (`samples/recipes/`) inklusive README — zeigt die
    Export- und Forget-Pipeline gegen den `compliance-profiles`-Default
    (`eu-dsgvo`).

  ### Fixes

  - `tier-engine`: auto-default-tier-Hook benutzt jetzt `ctx.db.raw` für
    Event-Store-Operationen (#37, vorher: stiller Bug, 22 Tage live).
  - `engine`: unsafe-projection-upsert nutzt `as never` statt `as any` —
    schmaler Cast-Surface, weniger Compiler-Knebel.
  - `visual-tree`: runtime-isolation marker für client-konsumierte Files,
    damit der Multi-Entry-Build den richtigen Bundle-Split bekommt.
  - `feature-ast`: vollständiger `unsafeSkipTransitionGuard`-Rename (war
    in zwei Modulen noch der alte Name).
  - `framework`: Error-Reasons + `noConsole`-Lint + No-Date-API-Guard
    wieder push-ready.

  ### Library-Updates

  hono 4.12, jose 6.2, stripe 22.1, meilisearch 0.58, marked 18,
  bun-types 1.3.13, lucide-react 1.14, bullmq 5.76, ioredis 5.10,
  i18next 26.0, react + radix-ui-primitives auf aktuelle Minors.

### Patch Changes

- Updated dependencies
  - @cosmicdrift/kumiko-dispatcher-live@0.3.0
  - @cosmicdrift/kumiko-headless@0.3.0
  - @cosmicdrift/kumiko-renderer@0.3.0

## 0.2.3

### Patch Changes

- @cosmicdrift/kumiko-dispatcher-live@0.2.3
- @cosmicdrift/kumiko-headless@0.2.3
- @cosmicdrift/kumiko-renderer@0.2.3

## 0.2.2

### Patch Changes

- 7a7da3e: Re-publish 0.2.1 → 0.2.2 mit korrekt aufgelösten cross-package-Versionen.
  0.2.1 hatte `workspace:*` als Wert in den dependencies (npm publish ohne
  yarn-pack rewrite), Konsumenten bekamen "Workspace not found".

  publish-with-oidc.sh nutzt jetzt `yarn pack` (rewrited workspace:\*) +
  `npm publish <tarball>` (OIDC + provenance).

- Updated dependencies [7a7da3e]
  - @cosmicdrift/kumiko-headless@0.2.2
  - @cosmicdrift/kumiko-dispatcher-live@0.2.2
  - @cosmicdrift/kumiko-renderer@0.2.2

## 0.2.1

### Patch Changes

- 48b7f6a: CI: switch publish to npm-CLI with OIDC Trusted Publishing + provenance.
  No source changes — verifies the new publish path produces a verified-
  provenance attestation on npmjs.com instead of token-based publish.
- Updated dependencies [48b7f6a]
  - @cosmicdrift/kumiko-headless@0.2.1
  - @cosmicdrift/kumiko-dispatcher-live@0.2.1
  - @cosmicdrift/kumiko-renderer@0.2.1

## 0.2.0

### Minor Changes

- 6c70b6f: fix(tenant): seedTenant idempotent gegen Event-Store-Projection-Drift.

  Verhindert version_conflict beim App-Boot wenn Aggregat existiert aber
  Projection-Row fehlt (rebuild-drift, async-lag, manueller DB-Eingriff).

### Patch Changes

- Updated dependencies [6c70b6f]
  - @cosmicdrift/kumiko-dispatcher-live@0.2.0
  - @cosmicdrift/kumiko-headless@0.2.0
  - @cosmicdrift/kumiko-renderer@0.2.0

## 0.1.0

### Minor Changes

- 59ba6d7: Initial public release of Kumiko — AI-native backend builder.

  What ships in 0.1.0:

  - **Engine** (`@cosmicdrift/kumiko-framework`): `defineFeature`, `r.entity`, `r.writeHandler`, `r.queryHandler`, `r.projection`, `r.multiStreamProjection`, `r.hook`, `r.translations`, `r.crud`, `r.referenceData`, `r.screen`, `r.nav`, `r.authClaims`, full lifecycle pipeline with field-level access checks
  - **Pipeline** (`@cosmicdrift/kumiko-framework`): `createDispatcher`, JWT auth via jose, Zod schema validation, role-based access checks, command/write/query split
  - **DB** (`@cosmicdrift/kumiko-framework`): Drizzle helpers (`buildDrizzleTable`, `applyCursorQuery`), CRUD executor, Postgres dialect, optimistic locking, soft delete, multi-tenant scoping
  - **Event sourcing** (`@cosmicdrift/kumiko-framework`): aggregate streams, single + multi-stream projections, event upcasters, asOf queries, archive support, AsyncDaemon-pattern dispatcher
  - **Bundled features** (`@cosmicdrift/kumiko-bundled-features`): auth-email-password, sessions, tenants, users, jobs, secrets, file-provider-s3, mail-transport-smtp/inmemory, billing-foundation, cap-counter, channel-in-app, delivery, feature-toggles, legal-pages
  - **Renderer** (`@cosmicdrift/kumiko-renderer`, `@cosmicdrift/kumiko-renderer-web`): schema-driven CRUD UI for React + Expo Web, override paths, list debounce, theme tokens
  - **Headless** (`@cosmicdrift/kumiko-headless`): view-models for list/edit screens, locale-aware
  - **Dev server** (`@cosmicdrift/kumiko-dev-server`): `runDevApp`, `runProdApp`, `kumiko-build` for production bundles (client + server), Docker-ready
  - **Realtime** (`@cosmicdrift/kumiko-dispatcher-live`): SSE broadcast across tenants, Redis Pub/Sub backend
  - **CLI** (`bin/kumiko.ts`): interactive dev menu, test runners, check pipeline (Biome + TypeScript + 18 guards + Vitest)

  This is a pre-1.0 release — APIs may change between minor versions. Breaking changes will be documented per release.

### Patch Changes

- Updated dependencies [59ba6d7]
  - @cosmicdrift/kumiko-dispatcher-live@0.1.0
  - @cosmicdrift/kumiko-headless@0.1.0
  - @cosmicdrift/kumiko-renderer@0.1.0
