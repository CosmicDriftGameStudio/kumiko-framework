export {
  HOST_ROUTING_FEATURE,
  HostRoutingQueries,
  isTenantKeyCandidate,
  TENANT_KEY_MAX_LENGTH,
} from "./constants.ts";
export {
  createHostDispatch,
  type HostRoutingDispatchFn,
  type HostRoutingDispatchResult,
  type HostRoutingRequest,
} from "./dispatch.ts";
export { createHostRoutingFeature } from "./feature.ts";
export { normalizeHostname } from "./host.ts";
export type {
  HostRoutingApexSurface,
  HostRoutingLocales,
  HostRoutingOptions,
  HostRoutingSurface,
  HostRoutingTenantMode,
} from "./options.ts";
