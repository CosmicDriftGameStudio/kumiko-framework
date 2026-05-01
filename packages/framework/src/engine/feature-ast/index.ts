// Public API of the feature-ast module. Consumers (Designer, AI patcher,
// CLI) import exclusively from here.

// Forwarded barrel — keeps the pattern-library reachable through
// @kumiko/framework/engine without forcing a separate sub-path import.
export type {
  FormFieldLabel,
  FormFieldSpec,
  FormInputType,
  PatternCategory,
  PatternFormSchema,
} from "../pattern-library";
export { getPatternSchema, groupByCategory, PATTERN_LIBRARY } from "../pattern-library";
export type { ParseError, ParseResult } from "./parse";
export { parseFeatureFile, parseSourceFile } from "./parse";
export type { PatternChange, PatternId } from "./patch";
export { addPattern, applyChanges, removePattern, replacePattern } from "./patch";
export type {
  AddAuthClaimsArgs,
  AddClaimKeyArgs,
  AddConfigArgs,
  AddDefineEventArgs,
  AddEntityArgs,
  AddEntityHookArgs,
  AddEventMigrationArgs,
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
  AddToggleableArgs,
  AddTranslationsArgs,
  AddUseExtensionArgs,
  AddWorkspaceArgs,
  AddWriteHandlerArgs,
  FeaturePatcher,
} from "./patcher";
export { createFeaturePatcher } from "./patcher";
export type {
  AuthClaimsPattern,
  ClaimKeyPattern,
  ConfigPattern,
  DefineEventPattern,
  Editability,
  EntityHookPattern,
  // Static patterns
  EntityPattern,
  EventMigrationPattern,
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
  SecretPattern,
  SystemScopePattern,
  ToggleablePattern,
  TranslationsPattern,
  // Catch-all
  UnknownPattern,
  UseExtensionPattern,
  WorkspacePattern,
  WriteHandlerPattern,
} from "./patterns";
export { getEditability } from "./patterns";
export type { RenderFeatureFileInput } from "./render";
export {
  FEATURE_FILE_VERSION,
  renderFeatureFile,
  renderPattern,
  renderValue,
  VERSION_HEADER,
} from "./render";
export type { SourceLocation, SourcePosition } from "./source-location";
export { sourceLocationFromNode } from "./source-location";
