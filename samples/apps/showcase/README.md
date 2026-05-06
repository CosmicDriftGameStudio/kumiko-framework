# Showcase

Kitchen-sink demo of the Kumiko renderer surface — every field type
that DefaultInput renders, every relevant layout path, every primitive
state reachable through normal click paths. Useful for a quick visual
and functional sweep during refactoring.

**No auth** — the server runs in auto-mint-JWT mode, you land on the
edit screen without a login. To exercise auth paths, see
`samples/apps/ui-walkthrough` or `samples/apps/workspaces`.

## Run

```bash
yarn kumiko dev                  # Postgres + Redis
cd samples/apps/showcase && yarn dev
# → http://localhost:4175
```

Port 4175 is hardcoded so three sample apps can run in parallel
(ui-walkthrough=4173, workspaces=4174).

## Click-through guide

### Empty state (list primitive)

After mount → list screen with "No entries." (`render-list-empty`).
Sidebar shows two nav entries ("Items", "New entry"), topbar has
brand + ThemeToggle.

### Form primitives + conditional visibility

Click "New entry" → entityEdit screen.

- **Section "Basics"** with a 2-column layout (`Section` with
  `columns: 2`), automatically single-column on mobile (<640px)
- **`title`** as a `text` input, full-width via `span: 2` (required
  marker red, right of the label)
- **`priority`** as a `number` input, default 1
- **`isDone`** as a checkbox
- **`status`** as a shadcn/Radix select dropdown with 4 options
  (draft/active/blocked/done), default "draft", full-width
- **Section "Details"** with a 1-column layout
- **`notes`** is INVISIBLE — `visible: (d) => d.isDone === true`,
  renders as a 4-row textarea when visible (`multiline: { rows: 4 }`)
- **`dueDate`** as a native date picker

→ Tick **`isDone`**: the `notes` textarea appears with a required
marker. Proves the FieldCondition pipeline.

→ Change the status in the dropdown: form controller marks dirty,
submit button enabled.

### Validation + submit-button states

- Submit button is **disabled** while the form is unchanged
  (`isUnchanged` gate) — visibly grey
- Type into `title` → button enables
- Tick isDone, leave title empty, submit → `field-error` on title
- Submit with valid input: navigates to the list

### List primitive with data + custom renderer

After the first submit → list screen.

- **DataTable** with columns Title, Status, IsDone (renders ✓ / ✗),
  Priority (custom renderer `(v) => v === 0 ? "—" : "P{v}"`), DueDate

→ Click a row → navigates to the edit form for that exact item
(useDispatcher.detail query).

### Optimistic locking + version conflict

- Two browser tabs: both on the edit screen for the same item
- Tab A: change the title, submit → success, navigates back
- Tab B: change the title, submit → **`version_conflict`** banner
  with a "Reload" button. Click → form rebases on the new server state.

### Theme toggle

Click the theme toggle (sun/moon top-right) → `<html class>` toggles
between `light` and `dark`. Tailwind tokens (background, foreground,
border, accent) follow.

### Responsiveness

- Drag the browser window below 640px → 2-column section becomes
  single-column (mobile breakpoint sm:)
- The form stays centered with `max-w-3xl` (768px) — on large screens
  inputs don't spread the full width

## What's provable

- Form controller: dirty/changes/errors tracking
- Validation: required + conditional required
- Optimistic locking: version stamp, conflict banner, reload path
- Field conditions: visible + required as functions on `data`
- DataTable: empty state, header row, cell renderers (boolean ✓/✗,
  custom render function)
- Layout: section title, responsive columns + span, KumikoLink, NavTree
- Theme: light/dark via TokensProvider
- AppSchema injection: no hand-written clientSchema, everything comes
  from the server

## What's NOT in here

- `timestamp` field type (Tier 2.2 pending)
- `money` field type (Tier 2.3 pending)
- Searchable Select (Tier 2.1c pending)
- Multi-Select (Tier 2.1d pending)
- `embedded` field type (Tier 2.4 pending — low priority)
- `file/image` field types (Tier 2.5/2.5b pending — resize pipeline + UI)
- Auth paths (see `samples/apps/ui-walkthrough/`)
- Workspaces (see `samples/apps/workspaces/`)
- TenantSwitcher with multiple tenants (see `samples/apps/ui-walkthrough/`)
- LanguageSwitcher (see `samples/apps/ui-walkthrough/`)

When a primitive lands, it belongs here.
