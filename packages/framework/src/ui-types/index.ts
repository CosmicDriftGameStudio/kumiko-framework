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

export type { ParsedRefTarget } from "../engine/parse-ref-target";
export { parseRefTarget } from "../engine/parse-ref-target";
// Entity + field types. EntityDefinition is the canonical shape that
// view-model builders iterate; FieldDefinition is the per-field union
// (text, number, boolean, ...) they branch on. AccessRule is used by
// resolveNavigation to gate entries by user roles.
export type {
  BooleanFieldDef,
  DateFieldDef,
  EntityDefinition,
  FieldDefinition,
  FileFieldDef,
  FilesFieldDef,
  ImageFieldDef,
  ImagesFieldDef,
  NumberFieldDef,
  SelectFieldDef,
  TextFieldDef,
} from "../engine/types/fields";
export type { AccessRule } from "../engine/types/handlers";
export type { NavDefinition } from "../engine/types/nav";
export type {
  ActionFormScreenDefinition,
  ConfigEditScreenDefinition,
  CustomScreenDefinition,
  CustomScreenRoute,
  DashboardChartPanel,
  DashboardCustomPanel,
  DashboardFeedPanel,
  DashboardFilterDefinition,
  DashboardListPanel,
  DashboardPanelDefinition,
  DashboardProgressListPanel,
  DashboardScreenDefinition,
  DashboardStatGroupPanel,
  DashboardStatPanel,
  EditExtensionSection,
  EditFieldSpec,
  EditFieldsSection,
  EditLayout,
  EditSectionSpec,
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
  FieldCondition,
  FieldRenderer,
  ListColumnSpec,
  PlatformComponent,
  ProjectionListScreenDefinition,
  RowAction,
  RowActionNavigate,
  RowActionWriteHandler,
  RowFieldExtractor,
  ScreenDefinition,
  ScreenFilter,
  ScreenFilterOp,
  ScreenSlots,
  ToolbarAction,
} from "../engine/types/screen";
export {
  evalFieldCondition,
  isExtensionEditSection,
  isFormatSpec,
  normalizeEditField,
  normalizeListColumn,
} from "../engine/types/screen";
export type { TargetRef } from "../engine/types/target-ref";
export type { TreeAction, TreeNode, TreeNodeState } from "../engine/types/tree-node";
export type { WorkspaceDefinition } from "../engine/types/workspace";
export type { AppSchema, FeatureSchema, WorkspaceSchema } from "./app-schema";
