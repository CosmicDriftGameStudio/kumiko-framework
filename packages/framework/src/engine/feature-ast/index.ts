// Public API of the feature-ast module. Consumers (Designer, AI patcher,
// CLI) import exclusively from here.

export type { ParseError, ParseResult } from "./parse";
export { parseFeatureFile, parseSourceFile } from "./parse";
export type { PatternChange, PatternId } from "./patch";
export { addPattern, applyChanges, removePattern, replacePattern } from "./patch";
export type {
  AddClaimKeyArgs,
  AddDefineEventArgs,
  AddEntityArgs,
  AddEntityHookArgs,
  AddEventMigrationArgs,
  AddHookArgs,
  AddHttpRouteArgs,
  AddJobArgs,
  AddMetricArgs,
  AddMultiStreamProjectionArgs,
  AddNotificationArgs,
  AddProjectionArgs,
  AddQueryHandlerArgs,
  AddReferenceDataArgs,
  AddRelationArgs,
  AddScreenArgs,
  AddSecretArgs,
  AddUseExtensionArgs,
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
