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
//   declare module "@cosmicdrift/kumiko-framework" {
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
  readonly title: string;
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
  | EntityEditScreenDefinition
  | ActionFormScreenDefinition
  | ConfigEditScreenDefinition
  | CustomScreenDefinition;

// Type guard — narrows FieldRenderer to FormatSpec. Useful for renderer
// authors who branch on the three FieldRenderer variants without manual
// "format" in renderer checks.
export function isFormatSpec(r: unknown): r is FormatSpec {
  return (
    typeof r === "object" &&
    r !== null &&
    "format" in r &&
    typeof (r as Record<string, unknown>)["format"] === "string"
  );
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

export function normalizeEditField(f: EditFieldSpec): Exclude<EditFieldSpec, string> {
  return typeof f === "string" ? { field: f } : f;
}
