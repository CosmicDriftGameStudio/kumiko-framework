import type { SelectOptionTone } from "./fields.ts";
import type { NavIconKey } from "./nav-icon.ts";
import type {
  ActionFormScreenDefinition,
  SecretMintScreenDefinition,
} from "./screen-action-form.ts";
import type {
  ConfigEditScreenDefinition,
  CustomScreenDefinition,
  SecretsEditScreenDefinition,
} from "./screen-custom-config.ts";
import type { DashboardScreenDefinition } from "./screen-dashboard.ts";
import type { EntityEditScreenDefinition } from "./screen-entity-edit.ts";
import type { EntityListScreenDefinition } from "./screen-entity-list.ts";
import type {
  ProjectionDetailScreenDefinition,
  ProjectionListScreenDefinition,
} from "./screen-projection.ts";

export type { FieldIconKey } from "./field-icon.ts";

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

// Closed set of unit identifiers for `{ format: "unit" }` (no bare `string`
// per house convention). "m2" has no ECMA-402 sanctioned unit — Intl throws
// RangeError for "square-meter" — so renderer/headless's applyFormatSpec
// formats it as a locale-formatted number with a literal "m²" suffix. The
// rest map to a CLDR-sanctioned Intl.NumberFormat unit id and get
// locale-correct pluralization/spacing straight from Intl.
export type UnitKey = "m2" | "km" | "m" | "kg" | "percent" | "mi";

type NumberFormatOptions = {
  readonly locale?: string;
  readonly grouping?: boolean;
  /** Intl `minimumFractionDigits` / `maximumFractionDigits` (integers 0..20,
   *  min <= max). Without them Intl cuts at 3 digits, so 0.0004 renders as
   *  "0". Invalid values are ignored. */
  readonly minimumFractionDigits?: number;
  readonly maximumFractionDigits?: number;
};

// Built-in value formatters. Apps extend via module augmentation:
//   declare module "@cosmicdrift/kumiko-framework/engine/types" {
//     interface FieldFormatRegistry { myFormat: { myOption?: string } }
//   }
// renderer/web handles all built-in keys; unknown app-specific keys fall back
// to String(value).
export interface FieldFormatRegistry {
  timestamp: {
    readonly locale?: string;
    readonly dateStyle?: "full" | "long" | "medium" | "short";
    readonly timeStyle?: "full" | "long" | "medium" | "short";
    /** IANA zone id (e.g. "Europe/Berlin"). Default: the runtime's zone. */
    readonly timeZone?: string;
  };
  date: {
    readonly locale?: string;
    readonly dateStyle?: "full" | "long" | "medium" | "short";
  };
  boolean: { readonly trueLabel?: string; readonly falseLabel?: string };
  currency: { readonly symbol?: string };
  priority: { readonly emptyLabel?: string; readonly prefix?: string };
  /** `grouping: false` renders without thousands-separators (e.g. a model
   *  year: "2021", not "2.021"). Default `true`. */
  number: NumberFormatOptions;
  /** Same options as `number`. */
  decimal: NumberFormatOptions;
  bigInt: { readonly locale?: string; readonly grouping?: boolean };
  // Value is percent *points* (12 → "12 %"), not a 0..1 ratio — Intl
  // style:"unit"/unit:"percent" does NOT multiply by 100 (unlike style:"percent").
  unit: {
    readonly unit: UnitKey;
    readonly locale?: string;
    readonly unitDisplay?: "long" | "short" | "narrow";
  };
  // Resolves an enum value through the i18n convention
  // `<feature>:entity:<entity>:field:<field>:option:<value>` — same
  // fallback-to-raw-value rule as buildOptionLabels: an untranslated key
  // renders the raw enum value instead of the literal i18n key.
  // Prefer fieldOptionLabelKeyPrefix() from @cosmicdrift/kumiko-renderer/headless
  // over hand-typed prefix strings.
  // `tones` draws the translated label as a status pill in list cells, the
  // way a select field with `optionTones` does on an entityList.
  enumOption: {
    readonly keyPrefix: string;
    readonly tones?: Readonly<Partial<Record<string, SelectOptionTone>>>;
  };
  /** Value is a `DashboardI18nText` (`{ i18nKey, i18nParams }`) a query built
   *  server-side, or a plain i18n key, translated in the user's language. */
  i18nText: Record<never, never>;
  /** JSON-safe structured value rendered as indented text. */
  json: { readonly indent?: number };
  /** List cell: FileRef id (or id array) as a thumbnail. `variant` names an
   *  image variant to request (falls back to the original if it is not served).
   *  Outside list cells the raw value is shown. */
  image: { readonly variant?: string };
  /** FileRef id (or id array) as a download link with the file name. On a
   *  read-only detail field it renders a file list with download links and an
   *  inline preview for PDFs; elsewhere the raw value is shown.
   *  `previewOpenByDefault` opens the newest (last) file's PDF preview initially. */
  file: { readonly previewOpenByDefault?: boolean };
}

// Discriminated union derived from the registry — one variant per key.
// JSON-safe: no function members, survives buildAppSchema → GET /api/schema.
export type FormatSpec = {
  [K in keyof FieldFormatRegistry]: { readonly format: K } & FieldFormatRegistry[K];
}[keyof FieldFormatRegistry];

// Level-2 field renderer (ui-architecture.md §Renderer Customization):
//   - PlatformComponent → platform-specific component from the same feature
//   - string            → cross-feature QN reference (resolved at mount-time)
//   - FormatSpec        → declarative value formatter, JSON-safe ({ format: "timestamp" } etc.)
export type FieldRenderer = PlatformComponent | string | FormatSpec;

export type { FieldCondition } from "./fields.ts";

// --- shared slots (Level 4 from ui-architecture.md) ---

export type ScreenSlots = {
  readonly header?: PlatformComponent;
  /** entityEdit / actionForm: rendered on the right of the form title, same row. */
  readonly titleAction?: PlatformComponent;
  readonly beforeForm?: PlatformComponent;
  readonly afterForm?: PlatformComponent;
  readonly sidebar?: PlatformComponent;
  readonly footer?: PlatformComponent;
  /** entityEdit wizard: marks `footer` as the sticky-footer primary action
   *  (pinned `max-sm:fixed` group on mobile) instead of the
   *  non-sticky secondary bucket it falls into by default alongside
   *  Back/Cancel. Set this when `footer` renders the screen's actual
   *  submit-type action (e.g. a custom "Publish" button standing in for, or
   *  beside, the built-in Finish/Save) — the renderer can't infer that from
   *  the slot's arbitrary rendered output, only from this declaration. */
  readonly footerPrimary?: boolean;
  readonly toolbar?: PlatformComponent;
};

// --- discriminated union ---

// Inline nav-entry sugar for `r.screen({ ..., nav: {...} })` — covers the
// common case of "one nav entry pointing at this screen". The nav entry's
// `id`/`screen` are synthesized from the screen's own id; for anything
// beyond label/icon/parent/order (access-gating, workspaces, actions),
// declare a standalone `r.nav()` entry instead.
export type ScreenNavSugar = {
  readonly label: string;
  readonly icon?: NavIconKey;
  readonly parent?: string;
  readonly order?: number;
};

// `nav`/`detailFor`/`description`/`agent` live directly on every variant (not only via this
// union) so a screen typed as its own concrete kind — e.g. `const screen:
// CustomScreenDefinition = {...}` in a module split out of `feature.ts` —
// still accepts all four; a union-only intersection drops them the
// moment a caller narrows to one member.
//
// `detailFor` applies to any screen kind because any kind can be the
// detail view for an entity — including `custom`: in app repos, detail
// screens are overwhelmingly custom screens today (projectionDetail
// doesn't carry entity semantics). Value is an entity name in the same
// (unqualified, globally-unique) form as `entity` on
// `EntityListScreenDefinition` — entities are never feature-prefixed, so
// there's no separate qualification step.
export type ScreenDefinition =
  | EntityListScreenDefinition
  | ProjectionListScreenDefinition
  | ProjectionDetailScreenDefinition
  | DashboardScreenDefinition
  | EntityEditScreenDefinition
  | ActionFormScreenDefinition
  | ConfigEditScreenDefinition
  | SecretsEditScreenDefinition
  | SecretMintScreenDefinition
  | CustomScreenDefinition;

export type {
  ActionFormFooterAction,
  ActionFormLoad,
  ActionFormRedirect,
  ActionFormScreenDefinition,
  ActionFormSuccessFact,
  ActionFormSuccessLink,
  FormFieldDerivation,
  FormFieldDerivationWithoutList,
  SecretMintConfirmStep,
  SecretMintScreenDefinition,
  SecretReveal,
  SecretRevealField,
} from "./screen-action-form.ts";
export type {
  ConfigEditScreenDefinition,
  CustomScreenDefinition,
  CustomScreenRoute,
  SecretsEditScreenDefinition,
  SecretsEditSection,
} from "./screen-custom-config.ts";
export type {
  DashboardChartKind,
  DashboardChartMarkerKind,
  DashboardChartPanel,
  DashboardChartRangeOption,
  DashboardChartRanges,
  DashboardChartTone,
  DashboardCurrencyFormat,
  DashboardCustomPanel,
  DashboardDateParam,
  DashboardFeedPanel,
  DashboardFilterDefinition,
  DashboardI18nText,
  DashboardListPanel,
  DashboardMoneyParam,
  DashboardPanelDefinition,
  DashboardPanelEmptyState,
  DashboardPanelGate,
  DashboardPanelQueryOptions,
  DashboardPanelSpan,
  DashboardPanelVisibility,
  DashboardProgressListPanel,
  DashboardProgressTone,
  DashboardRecordBinding,
  DashboardRefresh,
  DashboardRelativeTimeFormat,
  DashboardRelativeTimeParam,
  DashboardScopeDefinition,
  DashboardScreenDefinition,
  DashboardScreenPanel,
  DashboardStatGroupPanel,
  DashboardStatPanel,
  DashboardStatTone,
  DashboardText,
  DashboardTextBlock,
  DashboardTextPanel,
  DashboardTextParam,
  DashboardTimeRangeDefinition,
  DashboardValueFormat,
  ScreenFallback,
  ScreenFallbackByReason,
  ScreenFallbackReason,
  ScreenVisibility,
} from "./screen-dashboard.ts";
export {
  DASHBOARD_MIN_REFRESH_SECONDS,
  DASHBOARD_STAT_TONES,
  fallbackTargetFor,
  fallbackTargets,
  SCREEN_FALLBACK_REASONS,
} from "./screen-dashboard.ts";
export type {
  EditExtensionSection,
  EditFieldGroup,
  EditFieldPrefill,
  EditFieldSpec,
  EditFieldsSection,
  EditLayout,
  EditRelatedListSection,
  EditSectionSpec,
  EditWriteFormSection,
  EmbeddedListEditSpec,
  EntityEditAction,
  EntityEditActionPlacement,
  EntityEditScreenDefinition,
  EntityWriteExcludedFields,
  FieldAffix,
  FieldFillAction,
  FormWidth,
  ListEmptyStateSpec,
  RelatedListEmptyStateSpec,
  RelatedListEmptyStateVariant,
  RelatedListRowTone,
} from "./screen-entity-edit.ts";
export { relatedListGroupHeaderLabel, relatedListGroupKey } from "./screen-entity-edit.ts";
export type {
  EntityListFacetConfig,
  EntityListFacetExtraOption,
  EntityListScreenDefinition,
  ListBadgeTone,
  ListColumnDisplay,
  ListColumnSpec,
  ListPaginationMode,
  ListSortDir,
  ListSortSpec,
  RelatedListToolbarAction,
  RowAction,
  RowActionClientAction,
  RowActionDisplay,
  RowActionDrawer,
  RowActionMode,
  RowActionNavigate,
  RowActionNavigateBase,
  RowActionWriteHandler,
  RowFieldExtractor,
  ScreenFilter,
  ScreenFilterOp,
  ToolbarAction,
} from "./screen-entity-list.ts";
export type { EntityListExpandableRow, ExpandableRowGrouping } from "./screen-expandable-row.ts";
export type { ListBulkAction } from "./screen-list-bulk.ts";
export { LIST_BULK_ACTION_KEYS, MAX_BULK_SELECTION } from "./screen-list-bulk.ts";
export type {
  BundledListsOptions,
  ListColumnPin,
  ListTableDensity,
  ListTableExportOptions,
  ListTableGrouping,
  ListTableOptions,
  ListTableTotal,
} from "./screen-list-table.ts";
export {
  DEFAULT_EXPORT_MAX_ROWS,
  LIST_COLUMN_PINS,
  LIST_TABLE_DENSITIES,
  LIST_TABLE_DENSITY_KEYS,
  LIST_TABLE_EXPORT_KEYS,
  LIST_TABLE_GROUPING_KEYS,
  LIST_TABLE_OPTION_KEYS,
  LIST_TABLE_TOTAL_KEYS,
  MAX_EXPORT_MAX_ROWS,
} from "./screen-list-table.ts";
export type {
  ListFacetSpec,
  MetricNavigate,
  MetricSpec,
  ProjectionDetailScreenDefinition,
  ProjectionListScreenDefinition,
  RecordHeaderSpec,
  RecordHeaderSubtitlePart,
} from "./screen-projection.ts";
