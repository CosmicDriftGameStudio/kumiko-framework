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
} from "../pattern-library/index.js";
export { getPatternSchema, groupByCategory, PATTERN_LIBRARY } from "../pattern-library/index.js";
export type { ParseError, ParseResult } from "./parse.js";
export { parseFeatureFile, parseSourceFile } from "./parse.js";
export type {
  HandlerHeaderUpdate,
  PatternChange,
  PatternId,
  QueryHandlerHeaderKey,
  StreamHandlerHeaderKey,
  WriteHandlerHeaderKey,
} from "./patch.js";
export {
  addPattern,
  applyChanges,
  removePattern,
  replacePattern,
  SINGLETON_KINDS,
  updatePattern,
} from "./patch.js";
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
} from "./patcher.js";
export { createFeaturePatcher } from "./patcher.js";
export type { PatternChangeIssue, PatternChangesParseResult } from "./pattern-change-schema.js";
export { parsePatternChanges } from "./pattern-change-schema.js";
export type {
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
} from "./patterns.js";
export { getEditability } from "./patterns.js";
export type { RenderFeatureFileInput } from "./render.js";
export {
  FEATURE_FILE_VERSION,
  renderFeatureFile,
  renderPattern,
  renderValue,
  VERSION_HEADER,
} from "./render.js";
export type { SourceLocation, SourcePosition } from "./source-location.js";
export { sourceLocationFromNode } from "./source-location.js";
