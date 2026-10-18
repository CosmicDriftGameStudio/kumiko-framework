export {
  HOST_ROUTING_FEATURE,
  HostRoutingQueries,
  isTenantKeyCandidate,
  TENANT_KEY_MAX_LENGTH,
} from "./constants.js";
export {
  createHostDispatch,
  type HostRoutingDispatchFn,
  type HostRoutingDispatchResult,
  type HostRoutingRequest,
} from "./dispatch.js";
export { createHostRoutingFeature } from "./feature.js";
export { normalizeHostname } from "./host.js";
export type {
  HostRoutingApexSurface,
  HostRoutingLocales,
  HostRoutingOptions,
  HostRoutingSurface,
  HostRoutingTenantMode,
} from "./options.js";
