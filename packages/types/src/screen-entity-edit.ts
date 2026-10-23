import type { FieldIconKey } from "./field-icon.ts";
import type { FieldCondition, FieldDefinition, SelectOptionTone } from "./fields.ts";
import type { AccessRule, AgentScreenHints } from "./handlers.ts";
import type { IconKey } from "./nav-icon.ts";
import type { FieldRenderer, PlatformComponent, ScreenNavSugar, ScreenSlots } from "./screen.ts";
import type { ActionFormRedirect } from "./screen-action-form.ts";
import type { DashboardPanelVisibility } from "./screen-dashboard.ts";
import type {
  ListColumnSpec,
  ListSortSpec,
  RelatedListToolbarAction,
  RowAction,
  RowActionMode,
  RowFieldExtractor,
} from "./screen-entity-list.ts";
import type { ListBulkAction } from "./screen-list-bulk.ts";
import type { ListTableGrouping, ListTableOptions } from "./screen-list-table.ts";
import type { ListFacetSpec } from "./screen-projection.ts";

// --- entityEdit ---

// camelCase `readOnly` instead of the spec's lowercase `readonly`: TS's
// `readonly` modifier on the same line would make the declaration read
// `readonly readonly?: FieldCondition`, which is legal but a real lese-knick.
// Mirrors React's `readOnly` prop so the ergonomic cost of the divergence
// from ui-architecture.md is minimal.
export type EditFieldSpec =
  | string
  | {
      readonly field: string;
      readonly span?: number;
      readonly visible?: FieldCondition;
      readonly readOnly?: FieldCondition;
      readonly required?: FieldCondition;
      readonly renderer?: FieldRenderer;
      /** `false` keeps the field out of the submitted payload — for values
       *  that are shown or prefilled for display only (a label, a counter)
       *  and that the write handler's schema does not accept. Validation and
       *  rendering are unchanged. */
      readonly submit?: false;
      /** Prefix icon on the input — closed FieldIconKey vocabulary into
       *  the FIELD_ICONS registry (renderer/web), analogous to
       *  `ScreenNavSugar.icon` / NavIconKey. Only takes effect for
       *  single-line `type: "text"` and `"number"` — a `text` field with
       *  `multiline` routes to a textarea (no icon slot), and other input
       *  kinds (select, combobox, date, …) silently ignore the key. */
      readonly icon?: FieldIconKey;
      /** Input placeholder (i18n key, falls back to the literal). Only for
       *  single-line text, number and textarea inputs; other kinds ignore it. */
      readonly placeholder?: string;
      /** Static text shown before the input (i18n key, falls back to the
       *  literal), or `{ field }` for the current form value of another field
       *  (a hidden field carrying e.g. a base domain). Only for single-line
       *  text and number inputs; other kinds ignore it. */
      readonly prefix?: FieldAffix;
      /** Same as `prefix`, shown after the input. */
      readonly suffix?: FieldAffix;
      /** Button beside the input that runs a query and writes one scalar of
       *  its result into this field. Also offered on a readOnly field, where
       *  the value can only come from the suggestion. Only for single-line
       *  text and number inputs; other kinds ignore it. */
      readonly fillAction?: FieldFillAction;
      /** Marks this field as a reference lookup instead of a plain value —
       *  for projectionDetail fields, which have no `EntityDefinition` to
       *  carry a real `reference` field type. Same target convention as
       *  `parseRefTarget` (and `ListColumnSpec.refEntity`): an entity name
       *  (same feature) or `feature:entity` (cross-feature). Ignored on
       *  `entityEdit` fields, where the field's own declared type always
       *  wins. */
      readonly refEntity?: string;
      /** Row field on the referenced entity shown as the label (default
       *  "id"). Only meaningful together with `refEntity`. */
      readonly refLabelField?: string;
      /** Embedded-list fields only (`createEmbeddedListField`). */
      readonly embeddedList?: EmbeddedListEditSpec;
      /** Fills an empty value when the create form opens; the update form and
       *  values from URL params or a handoff are never touched. Unlike a
       *  field `default`, it is not applied server-side. */
      readonly prefill?: EditFieldPrefill;
    };

export type FieldAffix = string | { readonly field: string };

export type FieldFillAction = {
  /** i18n key (falls back to the literal) of the button label. */
  readonly label: string;
  /** Qualified query name, run with the current form values picked by `params`. */
  readonly query: string;
  /** Key in the query result written into the field; the value must be a
   *  string or a number, anything else counts as a failed fill. */
  readonly field: string;
  /** Form fields sent as the query payload (none: an empty payload). */
  readonly params?: RowFieldExtractor;
};

export type EmbeddedListEditSpec = {
  /** Sub-fields shown as read-only cells; every other cell stays editable. */
  readonly readOnlyCells?: readonly string[];
  /** `true` keeps the rows as they are: no add, remove, duplicate, move or
   *  paste-appended rows. Cells stay editable (unless in `readOnlyCells`). */
  readonly fixedRows?: boolean;
};

export type EditFieldPrefill =
  | { readonly kind: "today" }
  | {
      readonly kind: "currentUser";
      readonly property: "displayName" | "email" | "id";
    };

// A section is a normal field-grid (default — `kind` omitted keeps every
// existing screen-def working), an extension slot that mounts a feature-
// provided component, or a related-list of other records. The extension
// component is resolved client-side by name (same `__component` marker as
// custom screens / column renderers) and receives the host entity name +
// id, so a bundled feature (e.g. custom-fields) can load and persist its
// own data inside the form. `relatedList` runs its own query instead —
// see `EditRelatedListSection`.
export type EditSectionSpec =
  | EditFieldsSection
  | EditExtensionSection
  | EditRelatedListSection
  | EditWriteFormSection;

type EditFieldsSectionBase = {
  /** Kebab-case tab id, used as the `?tab=` value. Required by the
   *  boot-validator when the enclosing `EditLayout.mode` is "tabs". */
  readonly id?: string;
  readonly kind?: "fields";
  /** Optional. Without a title the section only renders its fields (no h3
   *  heading) — for flat forms (card title + fields directly, a single
   *  section) as in most shadcn form patterns. */
  readonly title?: string;
  /** Optional help text under the block heading (i18n key or raw string,
   *  like `title`) — makes a form usable without training instead of
   *  falling back to custom JSX for help text. Renders through the same
   *  `subtitle` slot as `FormProps.subtitle`. Works without `title` too
   *  (subtitle-only section). */
  readonly description?: string;
  readonly columns?: number;
  /** Rendered left of the section title, `text-muted-foreground` — closed
   *  IconKey vocabulary into the ICONS registry (renderer/web), analogous
   *  to EditFieldSpec.icon. No title → no icon, and no heuristic derives
   *  one from the title (titles are free i18n strings). */
  readonly icon?: IconKey;
  /** Record field rendered as a count badge in the tab label when the
   *  enclosing `EditLayout.mode` is "tabs" (e.g. an open-items counter).
   *  Ignored outside tabs mode or when the field's value is not a finite
   *  number. */
  readonly countField?: string;
  /** Short line (i18n key) under this step's title in the wizard step rail
   *  and in the "up next" box. Wizard layouts only; unlike `description` it
   *  is not shown inside the step. */
  readonly subtitle?: string;
  /** Rendered top-right in the section's Card title row — same
   *  navigate/drawer/writeHandler dispatch as `ProjectionDetailScreenDefinition.actions`,
   *  evaluated against the same record. Every action must resolve an icon
   *  (declared or id-derived); the boot-validator rejects one that doesn't. */
  readonly actions?: readonly RowAction[];
};

export type EditFieldGroup = {
  readonly title: string;
  readonly fields: readonly EditFieldSpec[];
  /** Default 2. */
  readonly columns?: number;
};

/** Either a flat `fields` grid or titled `groups` cards, never both: the groups branch has no
 *  `fields` key, so a raw `.fields` read on a section does not compile — use `sectionFieldSpecs`. */
export type EditFieldsSection = EditFieldsSectionBase &
  (
    | { readonly fields: readonly EditFieldSpec[] }
    | {
        /** Splits the section into multiple titled cards instead of one flat grid; fields named
         *  here still need to exist. */
        readonly groups: readonly EditFieldGroup[];
      }
  );

export type EditExtensionSection = {
  /** Kebab-case tab id, used as the `?tab=` value. Required by the
   *  boot-validator when the enclosing `EditLayout.mode` is "tabs". */
  readonly id?: string;
  readonly kind: "extension";
  readonly title: string;
  readonly component: PlatformComponent;
  /** When true, the extension registers via `useExtensionFormSubmit` and the
   *  surrounding form's Save button should activate for its dirty state.
   *  Omit/false for extensions that persist through their own dispatcher
   *  writes (e.g. notes-history NotesSection) — otherwise a read-only form
   *  shows a Save button that does nothing. */
  readonly contributesToFormSubmit?: boolean;
  /** Overrides the host-derived entity name passed to the mounted component.
   *  Required on `projectionDetail` (which has no real entity — the host
   *  value there is an internal placeholder) so a self-persisting extension
   *  like NotesSection filters/writes against the right domain entity. Takes
   *  precedence over the host value on every screen type. */
  readonly entityName?: string;
  /** Record field rendered as a count badge in the tab label when the
   *  enclosing `EditLayout.mode` is "tabs" (e.g. an open-items counter).
   *  Ignored outside tabs mode or when the field's value is not a finite
   *  number. */
  readonly countField?: string;
  /** Rendered top-right in the section's Card title row — same
   *  navigate/drawer/writeHandler dispatch as `ProjectionDetailScreenDefinition.actions`,
   *  evaluated against the same record. Every action must resolve an icon
   *  (declared or id-derived); the boot-validator rejects one that doesn't. */
  readonly actions?: readonly RowAction[];
};

/** Group key of a field value; `collapsedWhen` and server group keys both go through it. */
export function relatedListGroupKey(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

export function relatedListGroupHeaderLabel(
  grouping: Pick<ListTableGrouping, "label" | "labels">,
  groupKey: string,
): string | undefined {
  const labels = grouping.labels;
  return labels !== undefined && Object.hasOwn(labels, groupKey)
    ? labels[groupKey]
    : grouping.label;
}

/** Row tint rule: rows where the `FieldCondition` (`{ field, eq }`, `{ field,
 *  in }` …) holds get the tone. `bad` renders red. */
export type RelatedListRowTone = Exclude<FieldCondition, boolean> & {
  readonly tone: SelectOptionTone;
};

/** Replacement for the default "no rows" box of a list. `title`/`description`
 *  are i18n keys. `action` is a record action evaluated against an empty
 *  record on list screens (the parent record on a relatedList); its icon must
 *  resolve, same as `ProjectionDetailScreenDefinition.actions`. A narrowed list
 *  (search term or changed filters) shows the neutral "no matches" text instead. */
export type ListEmptyStateSpec = {
  readonly title: string;
  readonly description?: string;
  readonly action?: RowAction;
};

// Read-only list of related records, driven by its own query — for a
// projectionDetail screen showing e.g. a tenant's payments below the
// tenant's own fields. Only supported on projectionDetail; the
// boot-validator rejects it on entityEdit/configEdit/actionForm.
export type EditRelatedListSection = {
  /** Kebab-case tab id, used as the `?tab=` value. Required by the
   *  boot-validator when the enclosing `EditLayout.mode` is "tabs". */
  readonly id?: string;
  readonly kind: "relatedList";
  readonly title: string;
  /** Fully qualified query QN. Same paged envelope as projectionList.query:
   *  `{ rows, nextCursor, total? }`. */
  readonly query: string;
  /** Query-payload key the parent record's id is passed under. Default "id". */
  readonly parentParam?: string;
  /** Server-side WHERE clause pinning this section to the parent record —
   *  sent as `payload.filter: { field, op: "eq", value: parentId }`, kept
   *  out of the user-facet `filters` array so it can't be cleared by facet
   *  interaction. Lets a tab reuse the generic `<entity>:list` query instead
   *  of a bespoke child-rows handler. Mutually exclusive with `parentParam`
   *  (the boot-validator rejects both). `field` must be a real field on the
   *  entity behind `query`, and that query's Zod schema must accept
   *  `filter` (same requirement `filter`/`facets` already have). The filter is
   *  client-supplied: any caller may omit it, so the bound query must authorize
   *  the ENTIRE row set it can return, not just the parent's children. */
  readonly parentFilter?: { readonly field: string };
  readonly columns: readonly ListColumnSpec[];
  /** Entity the query's rows belong to: an entity name (same feature) or
   *  `feature:entity`. Columns that name one of its fields render like an
   *  entityList column of that field (select as a status badge with the
   *  translated option label, dates locale-formatted, default header from the
   *  field's label key). The column's own `sortable` still decides the
   *  header sort. Without it every column renders as plain text. */
  readonly entity?: string;
  /** i18n key for the one-line hint at the left of the tab toolbar. */
  readonly description?: string;
  /** i18n key holding plural forms for the footer count ("1 Position",
   *  "3 Positionen"). Omitted: generic "entries" wording. */
  readonly itemNoun?: string;
  readonly pageSize?: number;
  /** Opt-in table behaviour: remembered state, reset, column picker, density. */
  readonly table?: ListTableOptions;
  /** Initial sort on mount, applied client-side over the already-loaded rows
   *  (this section has no pager; if the fetch is truncated, `nextCursor !== null`,
   *  the section shows a hint banner that the sort covers only the loaded rows).
   *  `field` must name a column with `sortable: true` — boot-validator pins
   *  that, same as `entityList.defaultSort`. */
  readonly defaultSort?: ListSortSpec;
  /** Renders a search box whose debounced term rides along as
   *  `payload.search` on this section's own query. Opt-in, unlike
   *  `projectionList.searchable` (derived from the bound query's schema): a
   *  relatedList query is an ordinary child-rows handler, so a `search`
   *  parameter in its schema is not by itself a statement that this section
   *  should offer search. The boot-validator rejects `true` when the query's
   *  Zod schema has no `search` parameter. */
  readonly searchable?: boolean;
  /** User-toggleable facet dropdowns — same explicit-label `ListFacetSpec` as
   *  `projectionList.facets` (a relatedList has no entity to derive filterable
   *  fields from). `field` must be a declared column, except for
   *  `type: "reference"`: it filters by id through the bound query's
   *  `filters` and needs a registered `entity` instead. The bound query
   *  handler must accept `filters` in its Zod schema — the boot-validator
   *  checks both. Selected values ride along as `payload.filters`. */
  readonly facets?: readonly ListFacetSpec[];
  /** Row click opens the target entity's detail screen via ObjectTarget —
   *  the `detailFor` lookup owns the entity→screen mapping, so no screenId
   *  is named here. `idColumn` names the row key holding that id (default
   *  "id"). Omit `rowClick` for a non-interactive list. */
  readonly rowClick?: { readonly entity: string; readonly idColumn?: string };
  /** Per-row actions — same type and dispatch semantics as `entityList`/
   *  `projectionList`'s `rowActions` (writeHandler dispatch with a
   *  declarative `payload` extractor, or navigate). A successful
   *  writeHandler action re-runs this section's own query, same as a
   *  projectionList row action re-running its list query. */
  readonly rowActions?: readonly RowAction[];
  /** Layout of the row-action column — see `RowActionMode`. */
  readonly rowActionMode?: RowActionMode;
  /** Bulk actions over checkbox-selected rows, each pointing at a writeHandler row action. Adds a checkbox column and a selection bar; without it the list has no checkboxes. */
  readonly bulkActions?: readonly ListBulkAction[];
  /** Tints rows whose field matches — a declarative rule, not a function, so
   *  the screen definition stays serializable. */
  readonly rowTone?: RelatedListRowTone;
  /** Toolbar actions above the table — same type and dispatch semantics as
   *  `entityList`/`projectionList`'s `toolbarActions` ("+ Anlegen" etc.),
   *  plus `visible`/`params` evaluated against the parent record (see
   *  RelatedListToolbarAction). */
  readonly toolbarActions?: readonly RelatedListToolbarAction[];
  /** Record field rendered as a count badge in the tab label when the
   *  enclosing `EditLayout.mode` is "tabs" (e.g. an open-items counter).
   *  Ignored outside tabs mode or when the field's value is not a finite
   *  number. */
  readonly countField?: string;
  /** Rendered top-right in the section's Card title row — same
   *  navigate/drawer/writeHandler dispatch as `ProjectionDetailScreenDefinition.actions`,
   *  evaluated against the parent record. Every action must resolve an icon
   *  (declared or id-derived); the boot-validator rejects one that doesn't.
   *  Distinct from `toolbarActions` (rendered inside the DataTable toolbar) —
   *  this is the Card-level title-row action. */
  readonly actions?: readonly RowAction[];
  /** Rendered inside the section's Card in place of the table when this
   *  section's query returns zero rows. Omitted: the DataTable default
   *  ("kumiko.list.no-entries") applies. `action`'s icon must resolve, same
   *  as `actions` above. */
  readonly emptyState?: ListEmptyStateSpec;
};

// A declarative, self-persisting form section for `projectionDetail`
// (fw editable-detail-screens). Unlike the plain `fields` section — which
// projectionDetail forces read-only, see the type's own doc — this section's
// fields ARE editable and submit through their own write-handler, entirely
// independent of the (nonexistent) outer form submit. Modeled on
// `ActionFormScreenDefinition`: `fieldDefs` carries the field-type map (a
// projectionDetail's synthesized display entity has no real field types to
// draw on), `fields` the rendered order/overrides, same as
// `EditFieldsSection.fields`. Only supported on projectionDetail — the
// boot-validator rejects it on entityEdit/configEdit/actionForm, same as
// `relatedList`.
export type EditWriteFormSection = {
  /** Kebab-case tab id, used as the `?tab=` value. Required by the
   *  boot-validator when the enclosing `EditLayout.mode` is "tabs". */
  readonly id?: string;
  readonly kind: "writeForm";
  readonly title?: string;
  readonly description?: string;
  readonly columns?: number;
  readonly icon?: IconKey;
  /** Field-type map for this section's own form — same shape as
   *  `ActionFormScreenDefinition.fields`. */
  readonly fieldDefs: Readonly<Record<string, FieldDefinition>>;
  /** Rendered fields, in order — same shape as `EditFieldsSection.fields`.
   *  Every referenced field must have an entry in `fieldDefs`. */
  readonly fields: readonly EditFieldSpec[];
  /** Write-handler QN dispatched on submit. The submitted values (not a
   *  diff) land 1:1 as payload, same as `ActionFormScreenDefinition.handler`.
   *  The payload carries only this section's own fields — no parent/record
   *  id is injected automatically. To thread the host record's id through,
   *  declare it in `fieldDefs` with `visible: false` on its `fields` entry:
   *  it gets prefilled from the loaded record like any other field and rides
   *  along in the submit payload without being shown in the form. */
  readonly handler: string;
  /** i18n-key for the submit button. Default: "kumiko.actions.save". */
  readonly submitLabel?: string;
  /** Rendered top-right in the section's Card title row — same
   *  navigate/drawer/writeHandler dispatch as `ProjectionDetailScreenDefinition.actions`,
   *  evaluated against the same record. Every action must resolve an icon
   *  (declared or id-derived); the boot-validator rejects one that doesn't. */
  readonly actions?: readonly RowAction[];
};

// Max width of the form container (see FormScreenShell in renderer/web).
export type FormWidth = "3xl" | "4xl" | "full";

export type EditLayout = {
  readonly sections: readonly EditSectionSpec[];
  /** Default "4xl" (a centered column, narrower than list chrome), unless
   *  the app overrides it via `createKumikoApp({ screenWidth })`. Override
   *  per-screen to "3xl" for a narrower column or "full" to match list
   *  chrome. */
  readonly width?: FormWidth;
  /** Default "single". "wizard" renders one section per step (with
   *  progress + per-step validation) instead of all sections at once —
   *  boot-validator requires >= 2 sections, each with a title, when set.
   *  "tabs" renders one section per tab (projectionDetail only — the
   *  boot-validator rejects it on entityEdit, see the check for the reason);
   *  requires >= 2 sections, each with a title and an `id`. */
  readonly mode?: "single" | "wizard" | "tabs";
  /** "settings-list" lays each section out as a band with a title column on
   *  the left and one hairline-separated row per field (label + help left,
   *  control right) — the familiar settings pattern, for screens that are a
   *  list of independent preferences rather than one record form. Default
   *  "form" keeps the grid of cells. */
  readonly variant?: "form" | "settings-list";
  /** Persists in-progress wizard state as a resumable draft instead of
   *  discarding it on navigation away. */
  readonly draft?: boolean;
  /** Wizard layouts only. `upNext: true` adds an "up next" box to the step
   *  rail with the following step's title and `subtitle`; the last step
   *  shows none. */
  readonly wizard?: { readonly aside?: { readonly upNext: true } };
};

export type EntityWriteExcludedFields = {
  readonly create?: readonly string[];
  readonly update?: readonly string[];
};

export type EntityEditScreenDefinition = {
  readonly id: string;
  readonly type: "entityEdit";
  /** Default true: the screen fills the shell content height, its body scrolls
   *  inside and the pager / action bar stays pinned. `false` restores page
   *  scroll (table grows with its rows, pager below the last row, form footer
   *  in the flow). */
  readonly fillHeight?: boolean;
  readonly nav?: ScreenNavSugar;
  readonly detailFor?: string;
  readonly description?: string;
  readonly agent?: AgentScreenHints;
  /** Screen has no nav entry by design (opened via link or navved by the
   *  app); exempts it from the nav-area boot check. */
  readonly dormant?: boolean;
  /** UI-only gate, also on direct URL access; handlers still enforce access. Unmet or failed renders `fallback`. */
  readonly visibleWhen?: DashboardPanelVisibility;
  /** Same-feature short id or cross-feature QN `<feature>:screen:<id>` shown when `visibleWhen` is unmet (default: standard notice). */
  readonly fallback?: string;
  /** Derived by buildAppSchema from the navigate `params` targeting this
   *  screen — the only URL query keys the create form prefills. An authored
   *  value is overwritten. */
  readonly urlPrefillFields?: readonly string[];
  /** Derived by buildAppSchema from the entity's create/update write handlers
   *  (`excludeFields`): create hides these fields, update shows them read-only.
   *  An authored value is overwritten. */
  readonly writeExcludedFields?: EntityWriteExcludedFields;
  readonly entity: string;
  /** Entity field whose value names the loaded record in the header breadcrumb (edit mode only). */
  readonly recordTitleField?: string;
  /** Screen title (i18n key) with `{field}` placeholders filled from the
   *  current form values, so the title follows what the user types (create
   *  wizard: "Add {make} {model}"). Falls back to the plain title while the
   *  placeholders are still empty. */
  readonly titleTemplate?: string;
  /** Shows a saved record read-only while the condition holds for the loaded
   *  record (not for unsaved form values): all fields disabled, no save, discard
   *  or delete button; record `actions` stay. The title uses
   *  `screen:<id>.view.title`, then `screen:<id>.title`. Never applies to create.
   *  The entity's `lockedWhen` always applies as well; set this only to add a
   *  UI-only condition (either one shows the view).
   *  UI only: the update handler still has to enforce access. */
  readonly readOnly?: FieldCondition;
  readonly layout: EditLayout;
  /** Optional i18n key (or raw string) for the submit button. Default
   *  `kumiko.actions.save`. Lets the auto-edit screen show domain-specific
   *  CTAs ("Save Address", "Create item") instead of a generic "Save". */
  readonly submitLabel?: string;
  /** Default true. `false` for entities whose create runs through its own
   *  lifecycle write (e.g. incident:open with event stream + joins) instead
   *  of `<entity>:create`: suppresses the automatic "+ New" button on
   *  entityList screens of this entity and renders the create branch (call
   *  without entityId) as an error instead of a form whose submit would hit
   *  an unregistered handler. */
  readonly allowCreate?: boolean;
  /** Default true. `false` when no `<entity>:delete` handler exists
   *  (history/audit retention): suppresses the delete button in the
   *  update form. */
  readonly allowDelete?: boolean;
  /** Default false. `true` for singleton entities (exactly one record per
   *  tenant: organization, settings, tenant profile). A call without an
   *  `entityId` first resolves the existing record via `<entity>:list`
   *  (limit 1) and renders the update branch with prefill on a hit,
   *  instead of blindly creating another one. The create branch only
   *  fires when the table is empty (and `allowCreate: false` still
   *  applies there). */
  readonly singleton?: boolean;
  /** Navigate to this screen ID after a successful save (create or update).
   *  Either a same-feature short screen-ID, or a fully-qualified
   *  cross-feature screen QN (`<feature>:screen:<id>`) — the nav-router
   *  resolves both against the schema; boot-validator checks the target
   *  resolves to a registered screen. Overrides the default post-save
   *  target (the entity's list screen); delete is unaffected and still
   *  always navigates to the list. A cross-feature QN hard-couples this
   *  feature to the target at boot time — an app that doesn't mount the
   *  target feature fails the boot-validator; only use this form in a
   *  reusable feature when the target feature is guaranteed to be
   *  mounted alongside it.
   *
   *  The object form additionally names the success-payload field the
   *  navigation id comes from (`ActionFormRedirect.idFrom`) — needed when
   *  the edited record is a child and the target screen is the parent's
   *  detail screen. Update falls back to the loaded record when the
   *  success payload doesn't carry that field flatly; create falls back
   *  to the submitted form values. */
  readonly redirect?: string | ActionFormRedirect;
  /** Parent list screen (short id) for breadcrumb + nav highlighting when
   *  this screen has no nav entry of its own. Same field/semantics as on
   *  `custom`/`projectionDetail`; an explicit value here wins over the
   *  entity-list heuristic (rowAction target / same-entity entityList). */
  readonly listScreenId?: string;
  /** Optional per-field label i18n key (field name → key), overrides the
   *  default convention `<feature>:entity:<entity>:field:<name>`.
   *  Primarily for configEdit: its pseudo entity `__config-edit__` has no
   *  natural field namespace — the settings hub injects the config key's
   *  `mask.title` label here. A missing entry falls back to the
   *  convention. */
  readonly fieldLabels?: Readonly<Record<string, string>>;
  /** Record actions. Reuses `RowAction` — analogous to
   *  `ProjectionDetailScreenDefinition.actions` (the loaded record stands
   *  in for the "row"). `rowClick` has no target here and is rejected by
   *  the boot-validator, same as on projectionDetail. Not rendered in
   *  create mode — every action targets an existing record, which the
   *  create branch doesn't have yet. By default an action renders with the
   *  secondary form actions (footer, next to copy-link/delete/cancel);
   *  `placement: "menu"` moves it into the header "…" menu, ahead of
   *  copy-link/delete. Without a header menu (drawer, card form, shell
   *  without a header slot) a "menu" action falls back to inline. */
  readonly actions?: readonly EntityEditAction[];
  readonly slots?: ScreenSlots;
  readonly access?: AccessRule;
};

export type EntityEditActionPlacement = "inline" | "menu";

export type EntityEditAction = RowAction & {
  readonly placement?: EntityEditActionPlacement;
};
