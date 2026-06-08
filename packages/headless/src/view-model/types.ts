import type {
  EditFieldSpec,
  EditSectionSpec,
  FieldRenderer,
  ListColumnSpec,
  PlatformComponent,
  ScreenSlots,
} from "@cosmicdrift/kumiko-framework/ui-types";

// Runtime-only renderer — function form allowed here because the renderer
// layer (render-list) injects reference-column lookup closures at mount time.
// Never serialized to JSON.
export type RuntimeRenderer = (
  value: unknown,
  row?: Readonly<Record<string, unknown>>,
) => string;

// View-Models — plain data structures produced by computeListViewModel and
// computeEditViewModel. They flatten the combined [screen-def + entity-def
// + row-data + user] inputs into a shape the renderer draws directly,
// without re-resolving conditions or re-reading the entity field map.
//
// The renderer's render-list.tsx / render-edit.tsx are essentially
//   (viewModel) => JSX   // on web
//   (viewModel) => <View/Text>  // on native
// so everything the renderer needs to render one frame must be in here.
//
// Why pre-compute instead of resolving at render-time: predicates
// (visible/readonly/required) are arbitrary JS closures — running them
// inside React's render is wasteful (happens on every re-render, even
// when values haven't changed) and mixes side-effect-free view code
// with business logic. Computing once on form-state-change gives the
// renderer pure data and keeps render paths trivial.

// --- list view model ---

// One column, fully resolved. `label` is the localized string the
// renderer puts in the column header; view-model builder runs it through
// LocaleResolver.translate() from the i18nKey wired onto the field.
// `renderer` passes through ScreenDefinition's FieldRenderer verbatim; the
// renderer layer may also inject a RuntimeRenderer closure (reference lookups).
export type ListColumnViewModel = {
  readonly field: string;
  readonly label: string;
  readonly type: string; // field-type ("text", "number", "money", ...)
  readonly renderer?: FieldRenderer | RuntimeRenderer;
  readonly sortable: boolean;
  /** Nur bei `type: "select"` — translated Option-Labels keyed nach raw
   *  value. Renderer rendert `optionLabels[value]` statt humanizeSlug
   *  wenn vorhanden. Convention-Key: `<feature>:entity:<entity>:field:<field>:option:<value>`. */
  readonly optionLabels?: Readonly<Record<string, string>>;
  /** Nur bei `type: "reference"` — referenced Entity-Name für Bulk-
   *  Lookup im Renderer (`<refFeature>:query:<refEntity>:list`). */
  readonly refEntity?: string;
  /** Nur bei `type: "reference"` — Feature-Name in dem die referenced
   *  Entity wohnt. Default = current feature. Cross-Feature über
   *  qualifizierte Form ("feature:entity") am ReferenceFieldDef. */
  readonly refFeature?: string;
  /** Nur bei `type: "reference"` — Welches Feld der referenced Entity
   *  als Display-Wert in der Cell erscheint (Default "id"). */
  readonly refLabelField?: string;
};

export type ListRowViewModel = {
  readonly id: string;
  readonly values: Readonly<Record<string, unknown>>;
};

export type ListViewModel = {
  readonly screenId: string;
  readonly entityName: string;
  readonly columns: readonly ListColumnViewModel[];
  readonly rows: readonly ListRowViewModel[];
  readonly slots?: ScreenSlots;
  // Flags for the renderer to decide what kind of container to draw.
  readonly isEmpty: boolean;
};

// --- edit view model ---

// Resolved field — all predicates evaluated, labels translated. The
// renderer reads `{ visible, readonly, required }` directly without
// re-running any predicate.
export type EditFieldViewModel = {
  readonly field: string;
  readonly label: string;
  readonly type: string;
  readonly value: unknown;
  readonly visible: boolean;
  // `readOnly` (camelCase) matches the spec-side name on EditFieldSpec —
  // one convention through the stack. The TS property modifier `readonly`
  // (lowercase) only collides as a key name in type declarations of the
  // spec; here in the view-model we could have used either, but symmetric
  // naming beats clever ergonomics. Parallel-agent chose `readOnly` on
  // the input; we honour it on the output.
  readonly readOnly: boolean;
  readonly required: boolean;
  readonly span?: number;
  readonly renderer?: FieldRenderer;
  /** Nur bei `type: "select"` gesetzt — die zugelassenen Werte. Wird
   *  vom Renderer als Dropdown-Optionen genutzt. Quelle ist
   *  SelectFieldDef.options aus der EntityDefinition. */
  readonly options?: readonly string[];
  /** Nur bei `type: "select"` gesetzt — translated Labels pro Option,
   *  keyed nach raw value. Renderer zeigt `optionLabels[value]` als
   *  Dropdown-Label statt raw value. Convention-Key:
   *  `<feature>:entity:<entity>:field:<field>:option:<value>`. */
  readonly optionLabels?: Readonly<Record<string, string>>;
  /** Nur bei `type: "text"` gesetzt wenn TextFieldDef.multiline true
   *  ist — dann rendert der Renderer textarea statt single-line input.
   *  `true` = Default-Zeilen, `{ rows }` = explizite Höhe. */
  readonly multiline?: boolean | { readonly rows?: number };
  /** Nur bei `type: "reference"` gesetzt — Tier 2.7e-3.
   *  Die referenced Entity (kurz, ohne feature-prefix). Der Renderer
   *  baut die Query-QN als `<refFeature>:query:<refEntity>:list`. */
  readonly refEntity?: string;
  /** Nur bei `type: "reference"` gesetzt — Feature-Name in dem die
   *  referenced Entity wohnt. Same-feature default = aktuelles
   *  Feature. Cross-Feature wird über "feature:entity" am
   *  ReferenceFieldDef.entity erkannt. */
  readonly refFeature?: string;
  /** Nur bei `type: "reference"` gesetzt — Welches Feld der referenced
   *  Entity als Display-Label im Dropdown erscheint. Default: "id". */
  readonly refLabelField?: string;
  /** Nur bei `type: "reference"` — Multi-Mode (Tier 2.7e-Multi):
   *  Wert ist UUID-Array, Renderer mountet Multi-Combobox mit Tags. */
  readonly refMultiple?: boolean;
};

// Discriminated by `kind` — mirrors EditSectionSpec on the engine side.
// The builder always emits `kind` explicitly (no defaulting), so the
// renderer narrows with a strict equality check.
export type EditSectionViewModel = EditFieldsSectionViewModel | EditExtensionSectionViewModel;

export type EditFieldsSectionViewModel = {
  readonly kind: "fields";
  readonly title: string;
  readonly columns: number;
  readonly fields: readonly EditFieldViewModel[];
};

export type EditExtensionSectionViewModel = {
  readonly kind: "extension";
  readonly title: string;
  readonly component: PlatformComponent;
};

export type EditViewModel = {
  readonly screenId: string;
  readonly entityName: string;
  readonly id: string | null; // null on create (no existing row)
  readonly sections: readonly EditSectionViewModel[];
  readonly slots?: ScreenSlots;
};

// --- resolver interfaces (host-injected) ---

// The view-model builder calls this to translate i18n keys into strings.
// Normally the host passes the renderer's LocaleResolver.translate
// directly — keeping the interface narrow here avoids dragging the full
// LocaleResolver (with subscribe) into a pure compute path.
export type Translate = (key: string, params?: Readonly<Record<string, unknown>>) => string;

// Optional condition context forwarded to field visibility/readonly/required
// predicates. Same ctx the form-controller uses in conditional-fields — so
// a predicate that gated "admin-only" there keeps working here.
export type FieldConditionCtx = unknown;

// Re-export the ScreenDef spec halves we don't want ui-core callers to
// import from @cosmicdrift/kumiko-framework separately. Renderer packages expect a
// single import surface.
export type { EditFieldSpec, EditSectionSpec, FieldRenderer, ListColumnSpec, ScreenSlots };
