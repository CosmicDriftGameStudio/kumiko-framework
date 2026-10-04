// @runtime client
//
// Client-safe subset of engine types + the two normalize helpers. Split
// out into its own subpath (`@cosmicdrift/kumiko-framework/ui-types`) so ui-core and
// renderer packages can import without pulling node-only framework
// internals (postgres, drizzle-kit, ioredis, bullmq, ...) into the
// browser or Expo bundle through the main `./engine` barrel.
//
// The main `./engine` barrel re-exports `createApp`, `defineFeature`,
// and other server-runtime factories. Even with `import type` on the
// consumer side, some bundlers pull evaluation of the barrel, which
// transitively reaches `pg` / `ioredis` / `tls`. This entry stays narrow:
// types + the two pure-fn normalize helpers. No runtime imports of node
// built-ins or of framework DB / pipeline modules.
//
// The `type` re-exports below still chain into files that contain
// runtime code (fields.ts → ownership.ts → drizzle-orm; handlers.ts →
// ioredis etc.). With `verbatimModuleSyntax: true` and `import type` on
// every hop the bundler strips those; this file reaches only type-space.
// When adding a symbol here, verify it's either a type or a pure
// helper with no cross-module side-effects.

export { NO_WIDGET_FIELD_TYPES } from "@cosmicdrift/kumiko-types/fields";
export type { DerivedCellRoundingTarget } from "../engine/embedded-derived.js";
export { computeDerivedCellValue, roundDerivedCellValue } from "../engine/embedded-derived.js";
export type { ParsedRefTarget } from "../engine/parse-ref-target.js";
export { parseRefTarget } from "../engine/parse-ref-target.js";
export type { FieldsOrGroupsSection } from "../engine/screen-helpers.js";
export {
  evalFieldCondition,
  explicitListScreenId,
  isExtensionEditSection,
  isFieldsEditSection,
  isFormatSpec,
  isWriteFormEditSection,
  normalizeEditField,
  normalizeListColumn,
  resolveNavParentScreen,
  sectionFieldSpecs,
} from "../engine/screen-helpers.js";
// Entity + field types. EntityDefinition is the canonical shape that
// view-model builders iterate; FieldDefinition is the per-field union
// (text, number, boolean, ...) they branch on. AccessRule is used by
// resolveNavigation to gate entries by user roles.
export type {
  BooleanFieldDef,
  DateFieldDef,
  EmbeddedDerivedCellDef,
  EntityDefinition,
  FieldDefinition,
  FileFieldDef,
  FilesFieldDef,
  ImageFieldDef,
  ImagesFieldDef,
  NumberFieldDef,
  OptionsQueryPayload,
  OptionsQueryPayloadValue,
  SelectFieldDef,
  SelectOptionTone,
  TextFieldDef,
} from "../engine/types/fields.js";
export type {
  AccessRule,
  OpenToAllAccessRule,
  OpenToAllDeclaration,
  OpenToAllPersonalData,
  RoleAccessPersonalData,
  RoleAccessRule,
} from "../engine/types/handlers.js";
export { isOpenToAllGranted, isUiAccessGranted } from "../engine/types/handlers.js";
export type { IconKey, NavDefinition, NavIconKey } from "../engine/types/nav.js";
export type {
  ActionFormFooterAction,
  ActionFormRedirect,
  ActionFormScreenDefinition,
  ConfigEditScreenDefinition,
  CustomScreenDefinition,
  CustomScreenRoute,
  DashboardChartKind,
  DashboardChartMarkerKind,
  DashboardChartPanel,
  DashboardChartRangeOption,
  DashboardChartRanges,
  DashboardChartTone,
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
  DashboardScopeDefinition,
  DashboardScreenDefinition,
  DashboardScreenPanel,
  DashboardStatGroupPanel,
  DashboardStatPanel,
  DashboardText,
  DashboardTextParam,
  DashboardTimeRangeDefinition,
  DashboardValueFormat,
  EditExtensionSection,
  EditFieldSpec,
  EditFieldsSection,
  EditLayout,
  EditRelatedListSection,
  EditSectionSpec,
  EditWriteFormSection,
  EntityEditScreenDefinition,
  EntityListExpandableRow,
  EntityListFacetConfig,
  EntityListFacetExtraOption,
  EntityListScreenDefinition,
  FieldCondition,
  FieldIconKey,
  FieldRenderer,
  FormWidth,
  ListBadgeTone,
  ListColumnDisplay,
  ListColumnSpec,
  ListFacetSpec,
  ListSortSpec,
  MetricNavigate,
  MetricSpec,
  PlatformComponent,
  ProjectionDetailScreenDefinition,
  ProjectionListScreenDefinition,
  RecordHeaderSubtitlePart,
  RelatedListGroupBy,
  RelatedListRowTone,
  RelatedListToolbarAction,
  RowAction,
  RowActionDisplay,
  RowActionDrawer,
  RowActionMode,
  RowActionNavigate,
  RowActionWriteHandler,
  RowFieldExtractor,
  ScreenDefinition,
  ScreenFilter,
  ScreenFilterOp,
  ScreenSlots,
  SecretMintConfirmStep,
  SecretMintScreenDefinition,
  SecretReveal,
  SecretRevealField,
  SecretsEditScreenDefinition,
  SecretsEditSection,
  ToolbarAction,
} from "../engine/types/screen.js";
export {
  metricField,
  relatedListGroupHeaderLabel,
  relatedListGroupKey,
} from "../engine/types/screen.js";
export type { TargetRef } from "../engine/types/target-ref.js";
export type { TreeAction, TreeNode, TreeNodeState } from "../engine/types/tree-node.js";
export type { WorkspaceDefinition } from "../engine/types/workspace.js";
export {
  ACTION_FORM_ENTITY,
  PROJECTION_DETAIL_ENTITY,
  WRITE_FORM_SECTION_ENTITY,
} from "../i18n/required-surface-keys.js";
export type {
  AppSchema,
  FeatureSchema,
  QualifiedContentCollection,
  WorkspaceSchema,
} from "./app-schema.js";
export { type Formality, formalLocaleTag } from "./formality.js";
export type {
  ListRowMetaColumnType,
  ListRowMetaReference,
  ReferenceLookupSource,
  SystemReferenceLabel,
} from "./list-row-meta.js";
export {
  LIST_ROW_META_COLUMNS,
  LIST_ROW_META_REFERENCES,
  REFERENCE_LOOKUP_SOURCES,
  SYSTEM_REFERENCE_LABELS,
} from "./list-row-meta.js";
export {
  type PluralForms,
  resolveTranslationValue,
  type TranslationValue,
  translationValueOtherText,
} from "./plural.js";
