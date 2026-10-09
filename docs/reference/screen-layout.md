---
status: reference
verified: 2026-10-04
evidence: "packages/renderer/src/app/facet-count-bridge.tsx (chip counts refresh after writes); packages/renderer-web/src/primitives/index.tsx (responsive row actions, 44px touch targets); kumiko-framework#3449 (step picker, phone footer); packages/renderer-web/src/primitives/narrow-pinned-footer.tsx; kumiko-framework#3421 (phone header overflow); kumiko-framework#3381 (fixed-height screens, board layouts, drawer row actions); kumiko-framework#3414 (expandable rows); packages/types/src/screen.ts; packages/renderer/src/screen-fills-height.ts; packages/renderer/src/components/render-edit.tsx; packages/renderer/src/components/write-form-section.tsx; packages/framework/src/engine/boot-validator/screens.ts"
---

# Screen layout: fixed height, dimensions and declarative layout props

## fillHeight

Declarative screens fill the height of the shell content. The body (table, form sections, tab content) scrolls inside; the toolbar stays on top and the pager or action bar stays pinned at the bottom. A list with 3 rows and one with 300 rows show the pager at the same position.

- `fillHeight` defaults to `true` on `entityList`, `projectionList`, `projectionDetail`, `entityEdit` (including wizards) and `actionForm`.
- `fillHeight: false` restores page scrolling: the table grows with its rows, the pager sits below the last row, the form footer stays in the flow.
- Custom screens and direct `DataTable` or `Form` usage are unchanged. The default is applied on screen level, not in the primitives.
- Without a shell (or with `fill={false}` on the shell) the screen falls back to its content height.
- Below `sm` the pinned form and wizard footer is always one 56px row and never wraps. Back (`FOOTER_ACTION_ROLE_PROP: "back"`) shows as an icon button on the left. The primary action (`FOOTER_ACTION_ROLE_PROP: "primary"`, else the last submit button) fills the rest on one truncated line, with `NARROW_LABEL_PROP` as an optional shorter label (the wizard shows plain "Next"). Every other action moves into a "…" popover. The "…" button shows only while one of those actions is enabled, and a dot on it replaces the unsaved-changes text. From `sm` up the footer is unchanged.

## Dimensions

| Element | Size |
|---|---|
| Shell header | 56px |
| List toolbar | 52px (search 300x32) |
| Table head | 36px |
| Table row | 40px |
| Controls | 32px to 36px |
| Controls below `md` | at least 44px |
| Pager and list footer | 44px (60px below `md`, buttons 44x44) |
| Form and wizard footer | 56px |
| Drawer header, footer | 56px, 64px |

Row actions in tables are the exception to the 44px rule (28px kebab on desktop).

## PageHeader slot

The shell header hosts the breadcrumb (the last crumb is the `h1`) and two slots: status after the title and actions on the right. The optional `PageHeader` primitive (`{ status?, actions? }`) portals into them. Lists put the create button there, details put the status badge and the header actions there (first action a button, the rest in a kebab). Without a shell slot, callers keep their previous placement (create button in the toolbar, header card on details).

`PageHeaderProps` also carries `title` (overrides the last crumb), `recordTitle` (extra crumb before the last one) and `overflowItems` (`ActionMenuItemSpec[]`).

### Phone width

At phone width the shell header gives the title priority: the declarative screens keep their primary action as an icon button and move the rest into the shell's "…" menu (`data-testid="shell-header-overflow-trigger"`). The menu is a right-aligned dropdown with labelled rows (`role="menu"`, arrow-key navigation), and the app header controls inside it stack vertically. A list whose primary toolbar action has no `onCreate` (a navigate or drawer action) also gets that action as the header icon button on phones. E2E tests on mobile open that menu before they click a secondary header action.

Below 768 px the whole `[data-kumiko-layout="header-actions"]` container is hidden inside the closed "…" menu, so its controls are not reachable until the menu is open. E2E settled checks after login should wait for `[data-kumiko-layout="shell-header"]` instead, and open header actions through `shell-header-overflow-trigger`. An `ActionMenuItemSpec` can set `testId` to give its menu entry a stable `data-testid` (default `shell-header-overflow-item-<id>` in the header menu, `<trigger testId>-item-<id>` in row menus).

A custom screen that renders its own `PageHeader` decides the split itself. `usePageHeaderCompact()` from `@cosmicdrift/kumiko-renderer` is `true` while a shell with page header slots renders at phone width. The shell shows `overflowItems` only in that state and ignores them on desktop, so the screen branches:

```tsx illustration
const compact = usePageHeaderCompact();
<PageHeader
  actions={compact ? primaryIconButton : allButtons}
  {...(compact && { overflowItems: secondaryMenuItems })}
/>
```

The slot holds one `overflowItems` list per page; the last `PageHeader` that sets it wins. On a projectionDetail the framework header actions already own that list, so a `slots.header` component puts its own controls in the header content instead of `overflowItems`.

## Declarative props

| Prop | On | Purpose |
|---|---|---|
| `createLabel` | entityList, projectionList | i18n key for the create button (default `kumiko.actions.create`) |
| `searchPlaceholder` | entityList, projectionList | i18n key for the search placeholder |
| `optionTones` | select field | `{ [value]: "ok" \| "warn" \| "bad" \| "neutral" }`, shown as toned badge |
| `recordTitleField` | entityEdit | field of the loaded record shown as record crumb: "list > record > screen title" (edit mode only) |
| `recordTitleField` | projectionDetail | query output field that titles the page header (breadcrumb "list > record"); rejected together with `header` |
| `statusTones` | projectionDetail | same for the `status` field of the header badge |
| `subtitle` | projectionDetail | `header.subtitle`: a query output field, or a list of parts (field name or `{ field, navigate? }`) shown as one line under the title |
| `valueType` | relatedList column | `number`, `decimal`, `bigInt` or `money`: right-aligned tabular column and header |
| `hideOnNarrow` | list column | leaves the column out of the card layout below `md` |
| `description` | relatedList section | i18n key for the hint in the tab toolbar |
| `itemNoun` | relatedList section | i18n key with plural forms for the footer count |
| `summary` | actionForm | `{ title, subtitle? }` context box; `{name}` placeholders come from the drawer prefill |
| `facets` | entityList | `{ [field]: { display?: "select" \| "chips", showCounts?, hideEmpty?, extraOptions? } \| false }`; `false` hides the control |
| `defaultFilters` | entityList | `{ [field]: string[] \| boolean }`, initial filter; the URL wins |
| `rowActionMode` | entityList, projectionList, relatedList | `"adaptive"` (default) or `"inline"` |
| `display` | row action | `"button" \| "link" \| "icon"`; the action stays inline next to the kebab |
| `title`, `subtitle` | drawer action | i18n keys; `{param}` comes from the row prefill; `title` replaces `label` as the drawer title |
| `submit: false` | edit field | shown and validated, but not in the written payload |
| `footerActions` | actionForm | extra footer buttons: `{ id, label, icon?, variant?, patch }` |
| `submitPrefilled` | actionForm, secretMint | `true` enables submit without edits, so values seeded from navigate `params` count as intent |
| `groupBy`, `rowTone` | relatedList | collapsible row groups and a row tint rule |
| `subtitle` | wizard section | line under the step title in the rail |
| `wizard.aside` | entityEdit layout | `{ upNext: true }` adds an "up next" box |
| `titleTemplate` | entityEdit | title key with `{field}` placeholders from the form values |

## Header subtitle with several parts

`header.subtitle` takes a list when the line under the title names more than one thing. A part that sets `navigate` links to the referenced record.

```ts illustration
header: {
  title: "mieter",
  subtitle: [
    { field: "einheit", navigate: { entity: "unit", entityId: "unitId" } },
    { field: "liegenschaft", navigate: { entity: "property", entityId: "propertyId" } },
  ],
},
```

- A part with an empty value is left out together with its separator.
- A part becomes a link only when its target resolves and the user may open it, and, for `entity`/`entityId`, the `entityId` field is not empty. Otherwise it stays plain text. A part with `navigate` that has neither `screen` nor `entity` fails at boot.
- The separator "·" is its own element, hidden from assistive tech. The parts wrap onto a new line on narrow screens.
- `subtitleHref` (external URL for the whole subtitle) only works with the string form of `subtitle`; combining it with a list fails at boot.

## Tab panels

On a projectionDetail with `layout.mode: "tabs"`, every tab except a `relatedList` renders its content in an unframed panel with the page's content padding (`--card-padding`) and a gap below the tab strip, so it lines up with the tab labels. Extension tabs must not add padding of their own. A `relatedList` tab stays flush: the table runs from edge to edge under the tab strip.

## Drawer row actions

A row action with `kind: "drawer"` opens an `actionForm` of the same feature in a flush drawer (480px, right edge). The list or detail behind it stays mounted and refreshes after a successful submit.

```ts illustration
rowActions: [
  {
    kind: "drawer",
    id: "adjust-rent",
    label: "tenancy.actions.adjust-rent",
    screen: "adjust-rent", // actionForm id
    params: { pick: ["id"] },
  },
],
```

- Closing with unsaved input (X, Escape, overlay click, Cancel) asks "Discard changes?" first. "Keep editing" is the default focus. After a successful submit nothing is asked, so input is never lost silently.
- The drawer body scrolls, header and footer stay fixed. Long forms stay pages: use a `navigate` row action and an `entityEdit` screen.
- `kind: "drawer"` is also available on related list row actions and on toolbar actions. Without `kind: "drawer"`, actions behave as before.
- Each field of the form is prefilled from the row through `params` (`pick`, `map`) when the field names match.

## Expandable rows

`expandableRow` on an entityList puts a related list under each row. It takes the same fields as a projectionDetail `relatedList` section, without `id` and `countField`. The row's `id` is the parent id, passed through `parentFilter` or `parentParam` as in a tab.

```ts illustration
expandableRow: {
  kind: "relatedList",
  title: "campaigns.posts.title",
  query: "campaigns:query:campaign-post:list",
  parentFilter: { field: "campaign" },
  entity: "campaignPost",
  columns: [{ field: "datum", sortable: true }, "kanal", "status"],
  rowActions: [
    {
      kind: "writeHandler",
      id: "mark-posted",
      label: "campaigns.action.mark-posted",
      handler: "campaigns:write:campaign-post:mark-posted",
      payload: { pick: ["id"] },
    },
  ],
},
```

- An arrow button in a narrow first column opens and closes the area. It is a real button with `aria-expanded`, so Tab, Enter and Space work, and it never triggers the row click. Several rows can be open at once, and they stay open across reloads, sorting and paging.
- The area sits on the muted surface directly under the row: title and `actions` on top, then the list without its own card frame. The pager and the fixed screen height stay as they are; the area scrolls with the rows.
- A successful write from the area (row action, toolbar action, emptyState action, drawer submit) reloads the related list and the parent list, so a counter on the parent row updates.
- `entity` (also available on projectionDetail relatedList sections) names the entity behind the query rows, as an entity name or `feature:entity`. Columns that name one of its fields render like entityList columns: a select as a status badge with the translated option label, dates locale-formatted, and the header from the field's label key. The column's own `sortable` still decides the header sort. Without `entity`, every column is plain text.
- The boot validator checks the area like a relatedList section (query, columns against the output schema, handlers, rowClick target, defaultSort, search and facets).
- Custom DataTable primitives (for example a native renderer) implement `expandedRowIds`, `onToggleRowExpanded` and `renderExpandedRow` from `DataTableProps`. A primitive that ignores them renders the list without the arrow column.

## List filters and row actions

```ts illustration
facets: {
  status: {
    display: "chips",
    showCounts: true,
    hideEmpty: true,
    extraOptions: [{ id: "all", label: "campaigns.filter.all", values: [] }],
  },
},
defaultFilters: { status: ["open"] },
rowActionMode: "adaptive",
rowActions: [{ id: "mark-posted", label: "campaigns.action.mark-posted", handler: "...", display: "button" }],
```

- Chips are single choice: a click sets the chip's `values`, an empty `values` clears the facet. An `extraOptions` entry sits at the start unless `position: "end"`.
- Counts come from the list query itself: one request with `limit: 1` and `totalCount: true` per chip, with the other facets and the search applied. They refetch after every write the list starts (row action, toolbar action, drawer, expanded row) and follow the entity's live events like the rows do. `hideEmpty` needs the counts and keeps a chip visible while it is selected.
- `defaultFilters` applies only while the URL has no value for that field. Choosing "no filter" is stored in the URL as `~`, so the default does not come back. `facets: { field: false }` hides the control but keeps the filter active.
- With `display` set, the row-action column keeps that action inline next to the kebab even in the adaptive layout. Without `display`, nothing changes. `rowActionMode: "inline"` shows every action inline.
- `display: "responsive"` shows a button with icon and label in the table (768px and up) and only the icon in the narrow card layout, with the label as accessible name and tooltip. An action without a resolvable `icon` stays a labelled button. `"button"`, `"link"` and `"icon"` keep their look on every width.
- Below 768px, icon-only row actions and the expand arrow have a 44px touch target.
- relatedList `groupBy: { field, collapsedWhen?, label?, labels?, dateField? }` groups rows in order of first appearance under collapsible headers. The header key takes `{count}`, `{value}` and `{lastDate}`. A group with neither `label` nor a `labels` entry shows its rows without a header and stays open; boot rejects a `collapsedWhen` group without a header. `rowTone` is a field condition plus a tone, for example `{ field: "status", eq: "failed", tone: "bad" }`.
- A DataTable primitive that has no support for `rowGrouping`, `rowTone` or `filterFacets[].chips` (for example a native renderer) shows the flat list and the default facet control.

## Forms

- `submit: false` on an edit field keeps it out of the payload. Validation and rendering stay as they are.
- `footerActions` on an actionForm render before the submit button. A click sets `patch` on the form values, then submits through the normal validation and write path. The patched field does not have to be in the layout.
- A `writeForm` section that is the whole tab of a `projectionDetail` tabs layout puts its submit button into the pinned form footer, right-aligned like every other save button. Outside a tab (stacked sections) it keeps its submit in its own title row. `writeForm` is a `projectionDetail`-only primitive; the boot validator rejects it on other screen types.
- Wizard sections take `subtitle`; with `layout.wizard.aside.upNext` the step rail shows the next step's title and subtitle (not on the last step). `titleTemplate` follows what the user types and falls back to the screen title while a placeholder is empty.
- A wizard that edits an existing record shows each step as done by data, not position. A fields step is done when its fields validate (hidden fields and root issues ignored) and at least one visible, editable field that is not a select or boolean holds a non-empty value (`null`, `""`, `[]`, `0`, `false` and a money amount of 0 count as empty), or when the user passed it with Next. Every non-current step is a jump target. Jumping forward runs the same validate gate as Next on the current step and stays put with the field errors shown when it fails; jumping back is always allowed. Create-mode wizards keep position-based done state and only allow jumping back.
- Below `lg` (vertical rail) and `sm` (horizontal chips), an update-mode wizard shows the step label as an expandable step list with the same done and jump rules.
- An extension step of such a wizard gets `reportStepComplete(complete)` in its props (undefined everywhere else). Report through `useReportStepComplete(reportStepComplete, complete)` from `@cosmicdrift/kumiko-renderer` with whether the step already holds its data (`null` while it loads, which reports nothing), so the step bar shows it as done. App code needs no raw `useEffect` for this. Without a report the step is done only after the user passed it with Next.
- A `writeHandler` record action (projectionDetail and entityEdit header and section actions) takes an optional `redirect`, the same forms as entityEdit `redirect` (screen id or `{ screen, idFrom }`). A valid `returnTo` wins over it. The boot validator rejects a target that is not a registered screen. List row actions ignore it.
- A `writeHandler` record action that deletes the shown record (handler ends in `:delete` and the payload `id` is the record id, which the default payload satisfies) leaves the screen after success without any config: `returnTo`, else `redirect` if set, else `listScreenId` or the entity's list screen. With none of them the screen refetches.
- `successMessage` on an actionForm is an i18n key for a confirmation above the form after a successful submit. It only shows when the screen stays put: with a `redirect` set, or when the form is hosted in a drawer, it is ignored. `{field}` placeholders resolve from the submitted values, formatted for display. A `reference` field resolves to the chosen record's `labelField` instead of its id, so a cross-tenant admin form can name the record it just changed. If that lookup fails or the row is not in the capped lookup list, the placeholder falls back to the raw id.
- `submitPrefilled: true` on a full-page actionForm or secretMint lets a row action submit the form straight away, without the user editing anything. Every required field the layout hides with `visible: false` must be named by a navigate `params` source into the screen, otherwise boot fails. With `readOnly: true` instead of `visible: false` the user still sees which record the action applies to. The `params` keys of such a navigation must be declared, non-sensitive fields in the target layout. Without the flag a form holding only URL-prefilled values keeps its submit disabled.

```ts illustration
// projectionList row action
{ kind: "navigate", id: "rotate", label: "actions.rotate", screen: "webhook-subscriber-rotate", params: { pick: ["id"] } }

// target screen (SecretMintScreenDefinition)
{
  id: "webhook-subscriber-rotate",
  type: "secretMint",
  handler: "webhooks:write:subscriber:rotate",
  fields: { id: { type: "text", required: true } },
  layout: { sections: [{ fields: [{ field: "id", visible: false }] }] }, // or readOnly: true
  reveal: { fields: [{ field: "secret", label: "webhooks:field:secret" }] },
  submitPrefilled: true,
}
```

- An actionForm in a drawer shows `title` and `subtitle` of the opening drawer action instead of the action label.

Related: `docs/reference/theming.md` for tokens and fonts, `docs/reference/select-field.md` for the select presentation.
