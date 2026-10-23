// Public API of the feature-ast module. Consumers (Designer, AI patcher,
// CLI) import exclusively from here.

// Forwarded barrel — keeps the pattern-library reachable through
// @cosmicdrift/kumiko-framework/engine without forcing a separate sub-path import.
export type {
  FormFieldLabel,
  FormFieldSpec,
  FormInputType,
  PatternCategory,
  PatternFormSchema,
} from "../pattern-library/index.ts";
export { getPatternSchema, groupByCategory, PATTERN_LIBRARY } from "../pattern-library/index.ts";
export type { ParseError, ParseResult } from "./parse.ts";
export { parseFeatureFile, parseSourceFile } from "./parse.ts";
export type {
  HandlerHeaderUpdate,
  PatternChange,
  PatternId,
  QueryHandlerHeaderKey,
  StreamHandlerHeaderKey,
  WriteHandlerHeaderKey,
} from "./patch.ts";
export {
  addPattern,
  applyChanges,
  removePattern,
  replacePattern,
  SINGLETON_KINDS,
  updatePattern,
} from "./patch.ts";
export type {
  AddAuthClaimsArgs,
  AddClaimKeyArgs,
  AddConfigArgs,
  AddDefineEventArgs,
  AddEntityArgs,
  AddHookArgs,
  AddHttpRouteArgs,
  AddJobArgs,
  AddMetricArgs,
  AddMultiStreamProjectionArgs,
  AddNavArgs,
  AddNotificationArgs,
  AddOptionalRequiresArgs,
  AddProjectionArgs,
  AddQueryHandlerArgs,
  AddReadsConfigArgs,
  AddReferenceDataArgs,
  AddRelationArgs,
  AddRequiresArgs,
  AddScreenArgs,
  AddSecretArgs,
  AddStreamHandlerArgs,
  AddToggleableArgs,
  AddTranslationsArgs,
  AddUseExtensionArgs,
  AddWorkspaceArgs,
  AddWriteHandlerArgs,
  FeaturePatcher,
} from "./patcher.ts";
export { createFeaturePatcher } from "./patcher.ts";
export type { PatternChangeIssue, PatternChangesParseResult } from "./pattern-change-schema.ts";
export { parsePatternChanges } from "./pattern-change-schema.ts";
export type {
  AdoptsBundledListsPattern,
  AuthClaimsPattern,
  ClaimKeyPattern,
  ConfigPattern,
  DefineEventPattern,
  Editability,
  // Static patterns
  EntityPattern,
  ExtendsRegistrarPattern,
  FeaturePattern,
  FeaturePatternKind,
  HookPattern,
  HttpRoutePattern,
  JobPattern,
  MetricPattern,
  MultiStreamProjectionPattern,
  NavPattern,
  NotificationPattern,
  OptionalRequiresPattern,
  ProjectionPattern,
  QueryHandlerPattern,
  ReadsConfigPattern,
  ReferenceDataPattern,
  RelationPattern,
  RequiresPattern,
  // Mixed patterns
  ScreenPattern,
  SecretNamespacePattern,
  SecretPattern,
  StreamHandlerPattern,
  SystemScopePattern,
  ToggleablePattern,
  TranslationsPattern,
  // Catch-all
  UnknownPattern,
  UseExtensionPattern,
  WorkspacePattern,
  WriteHandlerPattern,
} from "./patterns.ts";
export { getEditability } from "./patterns.ts";
export type { RenderFeatureFileInput } from "./render.ts";
export {
  FEATURE_FILE_VERSION,
  renderFeatureFile,
  renderPattern,
  renderValue,
  VERSION_HEADER,
} from "./render.ts";
export type { SourceLocation, SourcePosition } from "./source-location.ts";
export { sourceLocationFromNode } from "./source-location.ts";
