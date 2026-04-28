// Public API of the feature-ast module. Consumers (Designer, AI patcher,
// CLI) import exclusively from here.

export type { ParseError, ParseResult } from "./parse";
export { parseFeatureFile, parseSourceFile, sourceLocationFromNode } from "./parse";
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
export type { SourceLocation, SourcePosition } from "./source-location";
