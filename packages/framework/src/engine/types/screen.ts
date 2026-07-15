import type { FieldDefinition } from "./fields";
import type { AccessRule } from "./handlers";

// Screen definitions describe how a feature surfaces data to the user.
// Pure data — the engine stores these verbatim and ui-core / the renderer
// packages decide what to do with them. The framework must not import
// React / react-native from here; renderer components stay opaque so
// `engine/` imports don't pull the whole UI toolchain into every bundle.
//
// Note on `id`: feature authors write the short form ("product-list"); the
// registry overwrites `id` with the qualified name ("shop:screen:product-list")
// in its stored copies. Callers of `registry.getScreen(qn)` /
// `getAllScreens()` / `getScreensByEntity(...)` always see the qualified id.
// `feature.screens[shortId]` on the unregistered FeatureDefinition keeps
// the short form.

// A per-platform component pair — used anywhere a feature attaches a
// rendered component (screens, slots, routes, field renderers, future
// r.uiComponent). Both fields are `unknown` so the engine doesn't depend
// on React types; ui-core resolves the correct platform at mount-time.
// Framework code only checks structural presence.
export type PlatformComponent = {
  readonly react?: unknown;
  readonly native?: unknown;
};

// Built-in value formatters. Apps extend via module augmentation:
//   declare module "@cosmicdrift/kumiko-framework/engine/types" {
//     interface FieldFormatRegistry { myFormat: { myOption?: string } }
//   }
// renderer-web handles all built-in keys; unknown app-specific keys fall back
// to String(value).
export interface FieldFormatRegistry {
  timestamp: {
    readonly locale?: string;
    readonly dateStyle?: "full" | "long" | "medium" | "short";
    readonly timeStyle?: "full" | "long" | "medium" | "short";
  };
  date: {
    readonly locale?: string;
    readonly dateStyle?: "full" | "long" | "medium" | "short";
  };
  boolean: { readonly trueLabel?: string; readonly falseLabel?: string };
  currency: { readonly symbol?: string };
  priority: { readonly emptyLabel?: string; readonly prefix?: string };
}

// Discriminated union derived from the registry — one variant per key.
// JSON-safe: no function members, survives buildAppSchema → window.__KUMIKO_SCHEMA__.
export type FormatSpec = {
  [K in keyof FieldFormatRegistry]: { readonly format: K } & FieldFormatRegistry[K];
}[keyof FieldFormatRegistry];

// Level-2 field renderer (ui-architecture.md §Renderer Customization):
//   - PlatformComponent → platform-specific component from the same feature
//   - string            → cross-feature QN reference (resolved at mount-time)
//   - FormatSpec        → declarative value formatter, JSON-safe ({ format: "timestamp" } etc.)
export type FieldRenderer = PlatformComponent | string | FormatSpec;

// Declarative field-state condition. Evaluated by the renderer against the
// current row/form values. Three forms:
//   boolean          — static on/off (e.g. readOnly: true)
//   { field, eq }    — true when row[field] === eq
//   { field, ne }    — true when row[field] !== ne
// JSON-safe: survives buildAppSchema → window.__KUMIKO_SCHEMA__ stringify.
export type FieldCondition =
  | boolean
  | { readonly field: string; readonly eq: unknown }
  | { readonly field: string; readonly ne: unknown };

// --- entityList ---

// `string` shorthand when the column only needs its field name; the object
// form carries renderer / display overrides. normalizeListColumn() below
// collapses both into the object form for downstream consumers.
export type ListColumnSpec =
  | string
  | {
      readonly field: string;
      readonly renderer?: FieldRenderer;
      /** Optional header, overriding the default
       *  `<feature>:entity:<entity>:field:<field>` i18n convention. Resolved
       *  through `translate` like any header — an i18n key, or a plain literal
       *  shown verbatim if it isn't a key. Also the way to declare a *virtual*
       *  column whose `field` is NOT an entity field — a presentational column
       *  drawn entirely by a `columnRenderer` component that reads the `row`
       *  (e.g. a tag-chips cell), not a stored value. Such a column needs a
       *  label; without one it is rejected at boot as an unknown field. `field`
       *  is then just a stable column key (pick any unique slug). */
      readonly label?: string;
    };

// Pagination-Modi für entityList:
//   - "pages":     klassischer Pager (← 1 2 ... N →) — bookmarkable
//                  via ?page=N in der URL. Server liefert `total`
//                  damit der Pager "Page X of Y" rendern kann.
//                  Default für CRUD-/Admin-Listen.
//   - "infinite":  IntersectionObserver am Bottom — beim Sichtbar
//                  werden lädt cursor-basiert die nächste Page und
//                  appended an `rows`. Kein page-State in URL (Scroll-
//                  Position ist Browser-eigen).
//   - false:       Pagination aus — `executor.list()` lädt alles
//                  was zur Tenant-Sicht passt. Sinnvoll für kleine
//                  Lookup-/Master-Daten (≤ ~200 Rows).
export type ListPaginationMode = "pages" | "infinite" | false;

// Sort-State auf der Wire — Field-Name muss zur Entity-Definition
// passen UND als sortable: true markiert sein. Validator lehnt sonst
// beim Boot ab.
export type ListSortDir = "asc" | "desc";
export type ListSortSpec = {
  readonly field: string;
  readonly dir: ListSortDir;
};

// Screen-Level Filter — Author deklariert pro List-Screen einen festen
// Filter der bei jedem Query angewendet wird. Use-case: drei Buckets
// derselben Entity ("Upcoming Maintenance" / "Active Maintenance" /
// "Past Maintenance") ohne drei Custom-Pages — Filter pro Screen
// unterscheidet sie.
//
// Operatoren (Drizzle-konsistent):
//   eq/ne → field = value | field != value
//   lt/gt → field < value | field > value (numerisch / temporal)
//   in    → field IN (...values), value muss readonly array sein
//
// Field muss in der Entity existieren UND `filterable: true` haben
// (Boot-Validator pinned beides). `lt`/`gt` nur auf vergleichbaren
// Field-Types (number/money/date/timestamp/locatedTimestamp); auf
// text/boolean/select/multiSelect lehnt der Validator das ab.
//
// Security-Modell: Filter ist UX-Bucketing, KEINE Access-Boundary. Der
// Server appliziert den filter aus dem Payload — der Client kann ihn
// weglassen oder durch einen anderen ersetzen. Boundary bleiben
// access-rule + Tenant-Scope; Felder mit Sicherheits-Bias (encrypted,
// restricted) müssen dort geschützt werden, nicht über den Screen-Filter.
export type ScreenFilterOp = "eq" | "ne" | "lt" | "gt" | "in";
export type ScreenFilter = {
  readonly field: string;
  readonly op: ScreenFilterOp;
  readonly value: unknown;
};

/** Deklarativer Row-Field-Extraktor — JSON-sicher (kein Function-Prop,
 *  überlebt window.__KUMIKO_SCHEMA__ / buildAppSchema).
 *
 *  `pick`: extrahiert Felder 1:1. `{ pick: ["id", "version"] }` → `{ id: row.id, version: row.version }`
 *  `map`:  benennt um.        `{ map: { incidentId: "id" } }` → `{ incidentId: row.id }`
 *
 *  Limitation: computed/template-Werte können nicht ausgedrückt werden
 *  — solche Logik gehört server-side in den Write-Handler. */
export type RowFieldExtractor =
  | { readonly pick: readonly string[] }
  | { readonly map: Readonly<Record<string, string>> };

// RowAction — per-Row Button/Dropdown-Item das einen Write-Handler
// triggert oder zu einem anderen Screen navigiert.
//
// Pattern: row-level Lifecycle-Operations (Maintenance start/cancel/
// complete, Incident resolve, Order ship etc.) — Sachen die in einem
// CRUD-update kein passendes Verb haben aber als WriteHandler existieren.
//
// Discriminated Union mit `kind`:
//   - "writeHandler" (default): dispatched einen Write-Handler mit
//     Payload pro Row.
//   - "navigate" (Tier 2.7e): navigiert zu einem anderen Screen,
//     optional mit URL-Search-Params aus `params`. Use-case: "Edit",
//     "View Audit-Log", "Open in actionForm" etc.
export type RowAction = RowActionWriteHandler | RowActionNavigate;

export type RowActionWriteHandler = {
  /** Default für RowActions ohne explizit gesetzten `kind` —
   *  Backwards-kompatible Form. Kann auch explizit gesetzt werden. */
  readonly kind?: "writeHandler";
  /** Stable id pro Screen — kebab-case, eindeutig im Action-Set. */
  readonly id: string;
  /** Anzeige-Text (i18n-Key). */
  readonly label: string;
  /** Qualified-Name des Server-Handlers, z.B.
   *  "publicstatus:write:maintenance:start". Wird via useDispatcher
   *  dispatcht. */
  readonly handler: string;
  /** Deklarativer Payload pro Row. Default = `{ id: row.id }`.
   *  `pick` extrahiert Felder gleichen Namens; `map` benennt um. */
  readonly payload?: RowFieldExtractor;
  /** i18n-Key für die Confirm-Dialog-Description. Wenn gesetzt, öffnet
   *  ein Modal vor der Ausführung — der User muss explizit bestätigen.
   *  Zusammen mit `style: "danger"` ist das die Standard-Sicherheits-
   *  Garde für destruktive Aktionen. */
  readonly confirm?: string;
  /** i18n-Key für den Confirm-Button-Text im Dialog. Default = `label`
   *  (also "Delete" → "Delete"-Button im Confirm). Setzen wenn die
   *  Action einen langen Namen hat ("Mark Subscription as Cancelled")
   *  und der Button kürzer sein soll ("Cancel Subscription"). */
  readonly confirmLabel?: string;
  /** Conditional Visibility pro Row. */
  readonly visible?: FieldCondition;
  /** Visual-Style. "danger" rendert rot + erzwingt einen Confirm-
   *  Dialog (auch ohne expliziten `confirm`-Key). */
  readonly style?: "primary" | "secondary" | "danger";
};

export type RowActionNavigate = {
  readonly kind: "navigate";
  readonly id: string;
  readonly label: string;
  /** Screen-id (kurz, unqualified) zu dem navigiert wird. Boot-
   *  Validator prüft Existenz im selben Feature. */
  readonly screen: string;
  /** Feldname dessen Wert als entityId in den URL-Pfad eingebettet wird
   *  (`/<workspace>/<screen>/<entityId>`). entityEdit liest die Id
   *  AUSSCHLIESSLICH aus dem Pfad. Default: "id" wenn der Ziel-Screen
   *  ein entityEdit ist. */
  readonly entityId?: string;
  /** Deklarative URL-Search-Params aus row-Context. Wird in actionForm-
   *  Targets als initial values gelesen (actionForm pre-fillen).
   *  `pick` extrahiert Felder gleichen Namens; `map` benennt um. */
  readonly params?: RowFieldExtractor;
  /** Conditional Visibility pro Row. */
  readonly visible?: FieldCondition;
  readonly style?: "primary" | "secondary";
  /** Wenn true, löst ein Klick auf die ganze Zeile (nicht nur das Aktionsmenü)
   *  diese navigate-Action aus. Max. eine pro Liste (Boot-Validator prüft). Nur
   *  auf navigate — ein Row-Klick darf keinen (evtl. destruktiven, unbestätigten)
   *  Write auslösen, daher nicht auf writeHandler-Actions. */
  readonly rowClick?: boolean;
};

// ToolbarAction — Button im List-Header. Zwei Varianten: navigate auf
// einen anderen Screen (z.B. zu einem actionForm) oder direkt einen
// Handler dispatchen (z.B. "Sync All" ohne Form).
export type ToolbarAction =
  | {
      readonly kind: "navigate";
      readonly id: string;
      readonly label: string;
      /** Screen-id (kurz, unqualified) zu dem navigiert wird. */
      readonly screen: string;
      readonly style?: "primary" | "secondary";
    }
  | {
      readonly kind: "writeHandler";
      readonly id: string;
      readonly label: string;
      readonly handler: string;
      /** Statischer Payload ohne row-Context. Default = `{}`. */
      readonly payload?: Record<string, unknown>;
      /** i18n-Key für Confirm-Dialog-Description. Wenn gesetzt UND/ODER
       *  style="danger": Modal vor der Ausführung. */
      readonly confirm?: string;
      /** i18n-Key für Confirm-Button-Text im Dialog. Default = `label`. */
      readonly confirmLabel?: string;
      readonly style?: "primary" | "secondary" | "danger";
    };

export type EntityListScreenDefinition = {
  readonly id: string;
  readonly type: "entityList";
  readonly entity: string;
  readonly columns: readonly ListColumnSpec[];
  // Row renderer (Desktop) — when omitted, renderer draws the default table
  // from `columns`. cardRenderer fills the same role on compact layouts.
  readonly rowRenderer?: PlatformComponent;
  readonly cardRenderer?: PlatformComponent;
  /** Per-Row-Aktionen — rendert eine Actions-Spalte rechts in der Tabelle.
   *  Bis zu 2 actions als inline-Buttons; >2 als Kebab-Dropdown.
   *  Reihenfolge im Array = Reihenfolge in der UI. */
  readonly rowActions?: readonly RowAction[];
  /** Toolbar-Aktionen (List-Header). "Open Incident", "Schedule Maintenance"
   *  etc. — neben "+ Neu" wenn vorhanden. Reihenfolge im Array = UI-
   *  Reihenfolge, primary-style links. */
  readonly toolbarActions?: readonly ToolbarAction[];
  /** Server-side Filter, fest am Screen — drei Buckets derselben
   *  Entity ohne Custom-Pages (z.B. "Upcoming" / "Active" / "Past"
   *  Maintenance). User-side q-Search läuft AUF dem gefilterten Set
   *  oben drauf. Boot-Validator pinst dass field in der Entity existiert. */
  readonly filter?: ScreenFilter;
  // Pagination-Modus (Default "pages"). Bestimmt UI (Pager vs Scroll-
  // Sentinel) und ob der Server `total` mitliefern muss.
  readonly pagination?: ListPaginationMode;
  // Page-Größe. Default 50 — guter Kompromiss zwischen "viel sichtbar"
  // und "DB liefert schnell". Apps mit teurem Read (Joins, Computed-
  // Fields) gehen runter; Power-User-Listen (z.B. internal Analytics)
  // gehen hoch.
  readonly pageSize?: number;
  // Default-Sortierung beim Erst-Mount. Wenn URL-Param `?sort=…`
  // gesetzt ist, gewinnt der; sonst nutzt RenderList diesen Default.
  // `field` muss in der Entity sortable: true sein — Boot-Validator
  // pinnt das.
  readonly defaultSort?: ListSortSpec;
  // Search-Toolbar im UI an/aus. Server-Search geht IMMER über den
  // SearchAdapter (Meilisearch) — kein DB-ILIKE-Drift. Default true
  // wenn die Entity searchable Felder hat, sonst false.
  readonly searchable?: boolean;
  readonly slots?: ScreenSlots;
  readonly access?: AccessRule;
};

// --- projectionList ---

// Like entityList, but bound to an EXPLICIT query instead of an entity. The
// list-query is taken verbatim from `query` (a fully qualified QN like
// "ledger:query:schedule:list") — NOT derived from the screen's own feature —
// so a screen can render any read-projection, including one owned by a
// different feature (the entityList feature-local resolution can't). Columns
// carry their own labels (no entity to derive field-labels from); there is no
// auto create-navigation (a projection isn't an editable entity list). Row
// interaction is explicit via `rowActions`. The query must return the same
// paged envelope as an entity list-query: `{ rows, nextCursor, total? }`.
export type ProjectionListScreenDefinition = {
  readonly id: string;
  readonly type: "projectionList";
  readonly query: string;
  readonly columns: readonly ListColumnSpec[];
  readonly rowRenderer?: PlatformComponent;
  readonly cardRenderer?: PlatformComponent;
  readonly rowActions?: readonly RowAction[];
  readonly toolbarActions?: readonly ToolbarAction[];
  readonly pagination?: ListPaginationMode;
  readonly pageSize?: number;
  readonly defaultSort?: ListSortSpec;
  readonly searchable?: boolean;
  readonly slots?: ScreenSlots;
  readonly access?: AccessRule;
};

// --- dashboard ---

// Deklaratives Panel-Grid — Kennzahlen, Verläufe und Kurzlisten ohne
// Custom-JSX. Jedes Panel zieht seine Daten aus einer eigenen Query
// (fully-qualified QN, cross-feature erlaubt wie projectionList).
// Formatierung ist Sache des Query-Handlers: Stat-Werte kommen als
// anzeigefertige Strings/Zahlen aus der Read-Projection (ES-Read-Models
// shapen ihre Daten selbst; der Renderer formatiert nicht nach).

// Query-Result-Contract: flaches Record; `valueField` zeigt auf den
// anzeigefertigen Wert, `subField` optional auf eine Sub-Zeile,
// `toneField` optional auf "default" | "positive" | "warn".
export type DashboardStatPanel = {
  readonly kind: "stat";
  /** Stable id — kebab-case, eindeutig im Panel-Set. */
  readonly id: string;
  /** Anzeige-Text (i18n-Key). */
  readonly label: string;
  readonly query: string;
  readonly valueField: string;
  readonly subField?: string;
  readonly toneField?: string;
  /** Optionaler Delta-Chip (z.B. "↓23 %") neben dem Label. Nur wenn BEIDE
   *  Felder gesetzt sind UND der Query-Handler sie liefert, rendert der Chip
   *  — sonst bleibt die Kachel wie ohne Delta. `deltaToneField` fällt auf
   *  `toneField`/"default" zurück, wenn ungesetzt. */
  readonly deltaField?: string;
  readonly deltaDirectionField?: string;
  readonly deltaToneField?: string;
  /** Statisches Icon neben dem Label — anders als value/sub/delta variiert
   *  das Icon nicht pro Query-Result, sondern ist eine Author-Entscheidung
   *  wie das Panel selbst. Aufgelöst über dieselbe extensionSectionComponents-
   *  Registry wie custom-Panels; die registrierte Komponente ignoriert
   *  typischerweise entityName/entityId/filterParams (kein Entity-Kontext
   *  für ein reines Icon). */
  readonly icon?: PlatformComponent;
  /** Statischer CSS-Farbwert (z.B. "var(--color-debt)") für den Icon-Chip —
   *  Passthrough an die Kachel, keine Registry, kein Lookup. */
  readonly accentColor?: string;
};

// Query-Result-Contract: `{ points: { atMs, value | null }[],
// windowStartMs, windowEndMs }` — value=null zeichnet einen Einbruch.
export type DashboardChartPanel = {
  readonly kind: "chart";
  readonly id: string;
  readonly label: string;
  /** v1: geglättete Zeitreihe. Weitere Chart-Formen additiv. */
  readonly chart: "timeseries";
  readonly query: string;
};

// Kurzliste im Dashboard — Query-Contract wie projectionList
// (`{ rows, nextCursor, total? }`), gerendert ohne Pager/Toolbar.
export type DashboardListPanel = {
  readonly kind: "list";
  readonly id: string;
  readonly label: string;
  readonly query: string;
  readonly columns: readonly ListColumnSpec[];
};

// Betitelte Sektion aus mehreren Stat-Panels (z.B. "Net Worth": Assets/Debts/
// Net). Ein Nesting-Level, kein Group-of-Groups — jedes Kind bleibt ein
// vollwertiges DashboardStatPanel mit eigener Query/id/label, der Renderer
// zieht sie nur gemeinsam unter einen Sektions-Titel.
export type DashboardStatGroupPanel = {
  readonly kind: "stat-group";
  readonly id: string;
  readonly label: string;
  readonly stats: readonly DashboardStatPanel[];
};

// Nicht-tabellarische Kurzliste (z.B. "nächste Termine"). Query-Result-
// Contract: `{ rows: { primary: string; trailing?: string }[] }`.
export type DashboardFeedPanel = {
  readonly kind: "feed";
  readonly id: string;
  readonly label: string;
  readonly query: string;
  readonly emptyLabel?: string;
};

// Liste aus Label/Wert/Fortschrittsbalken (z.B. Tilgungsfortschritt pro
// Kredit). Query-Result-Contract: `{ rows: { label: string; value: string;
// fraction: number }[] }` — fraction wird auf 0..1 geclampt.
export type DashboardProgressListPanel = {
  readonly kind: "progress-list";
  readonly id: string;
  readonly label: string;
  readonly query: string;
};

// Eingehängte App-Komponente, die ihre Daten/Titel selbst verwaltet (wie ein
// custom Screen, nur als Panel — bleibt an ihrer Array-Position statt in
// einen separaten Slot zu wandern). Kein `query`, keine `label`: der Renderer
// löst `component` über dieselbe extensionSectionComponents-Registry auf wie
// entityEdit-Extension-Sections und List-Header-Slots.
export type DashboardCustomPanel = {
  readonly kind: "custom";
  readonly id: string;
  readonly component: PlatformComponent;
};

export type DashboardPanelDefinition =
  | DashboardStatPanel
  | DashboardStatGroupPanel
  | DashboardChartPanel
  | DashboardListPanel
  | DashboardFeedPanel
  | DashboardProgressListPanel
  | DashboardCustomPanel;

// Screen-weiter Picker (Combobox), dessen gewählter Wert unter `id` in JEDE
// Panel-Query dieses Screens gemerged wird (Query-Handler validieren den Wert
// selbst gegen die Tenant-Sicht — dies ist UX-Scoping, keine Access-Boundary).
// Genau eins von `options`/`optionsQuery` ist gesetzt (Boot-Validator prüft).
export type DashboardFilterDefinition = {
  readonly id: string;
  readonly label: string;
  readonly kind: "select";
  readonly placeholder?: string;
  /** i18n-Key für den "(alle)"-Eintrag. */
  readonly allLabel?: string;
  readonly options?: readonly { readonly value: string; readonly label: string }[];
  /** Query-Result-Contract: `{ rows: { value: string; label: string }[] }`. */
  readonly optionsQuery?: string;
};

export type DashboardScreenDefinition = {
  readonly id: string;
  readonly type: "dashboard";
  readonly panels: readonly DashboardPanelDefinition[];
  readonly filter?: DashboardFilterDefinition;
  readonly slots?: ScreenSlots;
  readonly access?: AccessRule;
};

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
    };

// A section is either a normal field-grid (default — `kind` omitted keeps
// every existing screen-def working) or an extension slot that mounts a
// feature-provided component. The extension component is resolved client-
// side by name (same `__component` marker as custom screens / column
// renderers) and receives the host entity name + id, so a bundled feature
// (e.g. custom-fields) can load and persist its own data inside the form.
export type EditSectionSpec = EditFieldsSection | EditExtensionSection;

export type EditFieldsSection = {
  readonly kind?: "fields";
  /** Optional. Ohne Titel rendert die Section nur ihre Felder (keine h3-
   *  Überschrift) — für flache Forms (Card-Titel + Felder direkt, ein
   *  einzelner Abschnitt) wie bei den meisten shadcn-Form-Mustern. */
  readonly title?: string;
  readonly columns?: number;
  readonly fields: readonly EditFieldSpec[];
};

export type EditExtensionSection = {
  readonly kind: "extension";
  readonly title: string;
  readonly component: PlatformComponent;
};

export function isExtensionEditSection(section: EditSectionSpec): section is EditExtensionSection {
  return section.kind === "extension";
}

export type EditLayout = {
  readonly sections: readonly EditSectionSpec[];
};

export type EntityEditScreenDefinition = {
  readonly id: string;
  readonly type: "entityEdit";
  readonly entity: string;
  readonly layout: EditLayout;
  /** Optionaler i18n-Key (oder Roh-String) für den Submit-Button. Default
   *  `kumiko.actions.save`. Lässt den Auto-Edit-Screen domain-spezifische
   *  CTAs zeigen ("Save Address", "Create item") statt generisch "Speichern". */
  readonly submitLabel?: string;
  /** Default true. `false` für Entities deren Create über einen eigenen
   *  Lifecycle-Write läuft (z.B. incident:open mit Event-Stream + Joins)
   *  statt über `<entity>:create`: unterdrückt den automatischen
   *  „+ Neu"-Button auf entityList-Screens dieser Entity und rendert den
   *  Create-Branch (Aufruf ohne entityId) als Fehler statt eines Forms,
   *  dessen Submit gegen einen nicht registrierten Handler liefe. */
  readonly allowCreate?: boolean;
  /** Default true. `false` wenn kein `<entity>:delete`-Handler existiert
   *  (History-/Audit-Erhalt): unterdrückt den Löschen-Button im
   *  Update-Form. */
  readonly allowDelete?: boolean;
  /** Optionaler per-Field-Label-i18n-Key (Field-Name → Key), überschreibt
   *  die Default-Konvention `<feature>:entity:<entity>:field:<name>`.
   *  Primär für configEdit: dessen Pseudo-Entity `__config-edit__` hat
   *  keinen natürlichen Field-Namespace — der Settings-Hub injiziert hier
   *  das `mask.title`-Label des Config-Keys. Fehlt ein Eintrag, gilt die
   *  Konvention. */
  readonly fieldLabels?: Readonly<Record<string, string>>;
  readonly slots?: ScreenSlots;
  readonly access?: AccessRule;
};

// --- actionForm ---

// Form-Screen für non-CRUD Write-Handler. Wird gerendert wie ein
// EntityEditScreen (sections + fields), aber:
//   - kein detail-fetch beim Mount (initial-state = field-defaults)
//   - kein CRUD-verb-mapping ("create"/"update") — Author gibt
//     explizit die Write-Handler-QN an
//   - Form-Object landet 1:1 als payload beim Handler; sein Zod-Schema
//     validiert weiter
//   - optional `redirect` zu einem anderen Screen nach Submit-Success
//
// Beispiele: "Send invitation" (mit recipient-email + role), "Approve
// invoice" (mit notes), "Bulk-import" (mit CSV-string + mode).
//
// Field-Shape: inline am Screen statt entity-Reference. Author hat
// explizite Kontrolle was die Form rendert ohne eine ganze Entity
// dafür anzulegen. Die FieldDefinitions sind dieselben wie auf
// Entities (text/select/number/...) — alle DefaultInput-Renderer
// greifen unverändert.
export type ActionFormScreenDefinition = {
  readonly id: string;
  readonly type: "actionForm";
  /** Write-Handler-QN der bei Submit gerufen wird. Form-Object landet
   *  1:1 als payload — Handler-Schema (Zod) validiert weiter. */
  readonly handler: string;
  /** Form-Shape: Field-Map pro Name. Nutzt dieselben FieldDefinitions
   *  wie Entity-Felder. Mindestens ein Feld erforderlich (Boot-
   *  Validator). */
  readonly fields: Readonly<Record<string, FieldDefinition>>;
  /** Layout analog zu EntityEditScreen: sections mit fields aus dem
   *  fields-Map oben. */
  readonly layout: EditLayout;
  /** i18n-key für den Submit-Button. Default: i18n-Default des
   *  Renderers (typischerweise "actions.submit"). */
  readonly submitLabel?: string;
  /** Nach erfolgreichem Submit zu dieser Screen-ID navigieren (kurze
   *  ID, z.B. "item-list" — gleiche Feature, der nav-Router resolved
   *  zum vollen Pfad). Cross-Feature-Redirect ist nicht supported.
   *  Wenn nicht gesetzt, bleibt der User auf dem Form-Screen. Boot-
   *  Validator prüft dass die ID einen registrierten Screen meint. */
  readonly redirect?: string;
  /** Ziel des Abbrechen-Buttons. Default: `redirect` (historisches
   *  Verhalten — Cancel und Submit-Redirect landen dann am selben Ort).
   *  `false` = kein Abbrechen-Button; richtig für Single-Action-Screens
   *  ohne verwerfbaren Zustand (z.B. "Test-Mail senden"), wo Abbrechen
   *  nur ein zweiter Weg zum selben Ziel wäre. Boot-Validator prüft
   *  String-Targets wie `redirect`. */
  readonly cancelTarget?: string | false;
  readonly slots?: ScreenSlots;
  readonly access?: AccessRule;
};

// --- custom ---

// Sub-route declared by a custom screen (Expo Router / URL-routing use).
// `path` is the route-segment appended to the screen's own path; the
// framework owns the outer routing. Components stay opaque.
export type CustomScreenRoute = {
  readonly path: string;
  readonly component: PlatformComponent;
};

export type CustomScreenDefinition = {
  readonly id: string;
  readonly type: "custom";
  readonly renderer: PlatformComponent;
  readonly routes?: readonly CustomScreenRoute[];
  /** Parent list screen for breadcrumb when this detail is not in nav. */
  readonly listScreenId?: string;
  readonly access?: AccessRule;
};

// --- configEdit ---

// Form-Screen der Tenant-/User-/System-Settings aus dem bundled
// config-Feature liest und schreibt. Wird gerendert wie ein
// EntityEditScreen (sections + fields), aber:
//   - Detail-Load via `config:query:values` (statt `<entity>:detail`)
//   - Pre-Fill nutzt `configKeys[shortName]` → qualifizierter Key, dann
//     `values[qualifiedKey].value`
//   - Submit feuert pro geändertem Feld einen `config:write:set` mit
//     {key, value, scope}; das config-feature behandelt jeden Key als
//     eigenes Aggregate (configValue.<keyHash>) und alle N Writes laufen
//     parallel (Promise.all). Per-Key idempotent → Retry safe.
//   - kein Singleton-Hack nötig: pro (key+tenantId) gibt's by-design
//     genau eine Row, der Bridge-Pattern aus dem Branding-MVP fällt weg
//
// Partial-Failure-Semantik: wenn von N parallelen Writes einer scheitert,
// bleiben die anderen committed (pro-Aggregate, kein Multi-Stream-Rollback).
// Das Form bleibt dirty bis der User retried — die schon erfolgreichen
// Writes feuern dann nochmal mit demselben Wert. Für `text` / `number` /
// `boolean` Keys ist das idempotent. Wer einen ConfigKey mit nicht-
// idempotentem Setter baut (Counter, append-only-list o.ä.) muss die
// Idempotenz im Setter sicherstellen.
//
// Field-Shape: inline am Screen wie bei `actionForm`. Author hat damit
// explizite Kontrolle über Input-Type (text/number/select/...) ohne
// Resolve-Ceremony — die FieldDefinitions sind dieselben wie auf
// Entities, alle DefaultInput-Renderer greifen unverändert. Field-
// Labels gehen über bestehende i18n-Konventionen (`<feature>:entity:
// <namespace>:field:<name>` o.ä. — der Author wählt den Namespace).
//
// scope MUSS mit der `createTenantConfig`/`createSystemConfig`/
// `createUserConfig`-Deklaration der referenzierten Keys
// übereinstimmen — der Boot-Validator pinnt das.
export type ConfigEditScreenDefinition = {
  readonly id: string;
  readonly type: "configEdit";
  /** scope für config:write:set Calls. Muss zur Scope-Deklaration der
   *  in `configKeys` referenzierten Keys passen — Boot-Validator
   *  prüft das gegen die Registry. */
  readonly scope: "tenant" | "system" | "user";
  /** Map: form-field-name (kurz, wie im Layout referenziert) → voll-
   *  qualifizierter Config-Key (`<feature>:config:<short>`). Boot-
   *  Validator prüft dass jeder qualifizierte Key in der Registry
   *  bekannt ist. */
  readonly configKeys: Readonly<Record<string, string>>;
  /** Form-Shape pro Field-Name. Selbe FieldDefinitions wie auf
   *  Entities/ActionForm. Field-Names matchen die Keys in `configKeys`
   *  — Boot-Validator pinnt das. */
  readonly fields: Readonly<Record<string, FieldDefinition>>;
  /** Layout: Sections mit Field-Refs. Identisch zu entityEdit/
   *  actionForm. */
  readonly layout: EditLayout;
  /** Optionaler per-Field-Label-i18n-Key (Field-Name → Key). Der
   *  Settings-Hub setzt hier `mask.title` des jeweiligen Config-Keys,
   *  damit das am Key deklarierte Label am generierten Feld erscheint —
   *  ohne es unter der `__config-edit__`-Konvention zu duplizieren.
   *  Fehlt ein Eintrag, gilt die Konvention. */
  readonly fieldLabels?: Readonly<Record<string, string>>;
  /** i18n-key für den Submit-Button. Default: "kumiko.actions.save". */
  readonly submitLabel?: string;
  readonly slots?: ScreenSlots;
  readonly access?: AccessRule;
};

// --- shared slots (Level 4 from ui-architecture.md) ---

export type ScreenSlots = {
  readonly header?: PlatformComponent;
  readonly beforeForm?: PlatformComponent;
  readonly afterForm?: PlatformComponent;
  readonly sidebar?: PlatformComponent;
  readonly footer?: PlatformComponent;
  readonly toolbar?: PlatformComponent;
};

// --- discriminated union ---

export type ScreenDefinition =
  | EntityListScreenDefinition
  | ProjectionListScreenDefinition
  | DashboardScreenDefinition
  | EntityEditScreenDefinition
  | ActionFormScreenDefinition
  | ConfigEditScreenDefinition
  | CustomScreenDefinition;

// Type guard — narrows FieldRenderer to FormatSpec. Useful for renderer
// authors who branch on the three FieldRenderer variants without manual
// "format" in renderer checks.
export function isFormatSpec(r: unknown): r is FormatSpec {
  return typeof r === "object" && r !== null && "format" in r && typeof r.format === "string";
}

// Collapse the string-shorthand into the object form. Both the boot-validator
// and (later) ui-core's view-model builder iterate over fields/columns — the
// helper keeps that loop from growing two branches everywhere.
export function normalizeListColumn(c: ListColumnSpec): Exclude<ListColumnSpec, string> {
  const col = typeof c === "string" ? { field: c } : c;
  if (
    typeof process !== "undefined" &&
    process.env.NODE_ENV !== "production" &&
    col.renderer !== undefined &&
    typeof col.renderer === "function"
  ) {
    // biome-ignore lint/suspicious/noConsole: dev-only warning
    console.warn(
      `[kumiko] normalizeListColumn: Feld "${col.field}" hat einen Funktions-Renderer — dieser wird von JSON.stringify verworfen. Bitte auf FormatSpec ({ format: "..." }) migrieren.`,
    );
  }
  return col;
}

/** Evaluates a declarative FieldCondition against the current row/form
 *  values. THE single implementation — renderer (row-action visibility),
 *  headless view-model (visible/readOnly/required) and render-edit
 *  (form-condition closures) reuse it; three hand-rolled copies had
 *  already drifted in shape. */
export function evalFieldCondition(cond: FieldCondition, values: Record<string, unknown>): boolean {
  if (typeof cond === "boolean") return cond;
  const val = values[cond.field];
  if ("eq" in cond) return val === cond.eq;
  return val !== cond.ne;
}

export function normalizeEditField(f: EditFieldSpec): Exclude<EditFieldSpec, string> {
  return typeof f === "string" ? { field: f } : f;
}
