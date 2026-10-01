---
status: reference
verified: 2026-10-01
evidence: "kumiko-framework#3381 (fixed-height screens, board layouts, drawer row actions); kumiko-framework#3414 (expandable rows); packages/types/src/screen.ts; packages/renderer/src/screen-fills-height.ts"
---

# Screen layout: fixed height, dimensions and declarative layout props

## fillHeight

Declarative screens fill the height of the shell content. The body (table, form sections, tab content) scrolls inside; the toolbar stays on top and the pager or action bar stays pinned at the bottom. A list with 3 rows and one with 300 rows show the pager at the same position.

- `fillHeight` defaults to `true` on `entityList`, `projectionList`, `projectionDetail`, `entityEdit` (including wizards) and `actionForm`.
- `fillHeight: false` restores page scrolling: the table grows with its rows, the pager sits below the last row, the form footer stays in the flow.
- Custom screens and direct `DataTable` or `Form` usage are unchanged. The default is applied on screen level, not in the primitives.
- Without a shell (or with `fill={false}` on the shell) the screen falls back to its content height.

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

## Declarative props

| Prop | On | Purpose |
|---|---|---|
| `createLabel` | entityList, projectionList | i18n key for the create button (default `kumiko.actions.create`) |
| `searchPlaceholder` | entityList, projectionList | i18n key for the search placeholder |
| `optionTones` | select field | `{ [value]: "ok" \| "warn" \| "bad" \| "neutral" }`, shown as toned badge |
| `recordTitleField` | entityEdit | field of the loaded record shown as record crumb: "list > record > screen title" (edit mode only) |
| `recordTitleField` | projectionDetail | query output field that titles the page header (breadcrumb "list > record"); rejected together with `header` |
| `statusTones` | projectionDetail | same for the `status` field of the header badge |
| `valueType` | relatedList column | `number`, `decimal`, `bigInt` or `money`: right-aligned tabular column and header |
| `hideOnNarrow` | list column | leaves the column out of the card layout below `md` |
| `description` | relatedList section | i18n key for the hint in the tab toolbar |
| `itemNoun` | relatedList section | i18n key with plural forms for the footer count |
| `summary` | actionForm | `{ title, subtitle? }` context box; `{name}` placeholders come from the drawer prefill |

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
  columns: ["datum", "kanal", "status"],
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
- The boot validator checks the area like a relatedList section (query, columns against the output schema, handlers, rowClick target, defaultSort, search and facets).
- Custom DataTable primitives (for example a native renderer) implement `expandedRowIds`, `onToggleRowExpanded` and `renderExpandedRow` from `DataTableProps`. A primitive that ignores them renders the list without the arrow column.

Related: `docs/reference/theming.md` for tokens and fonts, `docs/reference/select-field.md` for the select presentation.
