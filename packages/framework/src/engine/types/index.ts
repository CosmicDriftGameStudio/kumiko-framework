// Barrel: re-exports all types from @cosmicdrift/kumiko-types, plus the
// runtime helpers below that stay framework-side.
export type { JobRunIn } from "@cosmicdrift/kumiko-types/config";
// Cross-Feature Compile-Time-Type-Map — features extend per declare-module.
// Cross-Feature Compile-Time-Type-Map for r.useExtension options — mirrors KumikoEventTypeMap above.
export type {
  FeatureDefinition,
  Registry,
} from "@cosmicdrift/kumiko-types/feature";
// Closed field-icon vocabulary — used by `EditFieldSpec.icon`.
export type {
  ReferenceFieldDef,
  TextFieldDef,
} from "@cosmicdrift/kumiko-types/fields";
export type {
  AppContext,
  BeforeTransactionContext,
  ContextServices,
  EventPiiStance,
  HandlerAuth,
  HandlerContext,
  HandlerDb,
  HandlerDispatch,
  HandlerEvents,
  HandlerLifecycle,
  HandlerObservability,
  HandlerTenants,
  JobDispatch,
  JobEvents,
  JobLifecycle,
  JobObservability,
  QueryEvent,
  ReservationContext,
  SessionUser,
} from "@cosmicdrift/kumiko-types/handlers";
// Domain-identifier type aliases — see identifiers.ts for rationale.
export type { TenantId } from "@cosmicdrift/kumiko-types/identifiers";
export { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-types/identifiers";
export type { WhereRule } from "@cosmicdrift/kumiko-types/ownership";
export type {
  WebSocketConnection,
  WebSocketRouteDefinition,
} from "@cosmicdrift/kumiko-types/websocket-route";
// Re-export types that were duplicated in types.ts but are canonical in constants.ts
