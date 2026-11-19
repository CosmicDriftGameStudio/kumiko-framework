export const CONNECTORS_FEATURE = "connectors";
export const CONNECTOR_ENTITY = "connector";
export const INBOUND_ITEM_ENTITY = "inbound-item";

export const CONNECTOR_KIND = { satellite: "satellite" } as const;
export const CONNECTOR_STATUS = { active: "active", revoked: "revoked" } as const;
export type ConnectorStatus = (typeof CONNECTOR_STATUS)[keyof typeof CONNECTOR_STATUS];

export const DEVICE_AUTHORIZATION_STATUS = {
  pending: "pending",
  approved: "approved",
  redeemed: "redeemed",
} as const;

// A device-code request can name any client_id; the satellite sends this fixed one.
export const CONNECTOR_CLIENT_ID = "kumiko-satellite";
export const DEVICE_TOKEN_PREFIX = "ksat_";
export const DEVICE_TOKEN_PATTERN = /^ksat_[A-Za-z0-9_-]{20,200}$/;

// The preview asks once per typed character, so it gets more room than the confirm attempts.
export const PENDING_REQUEST_RATE_LIMIT = {
  per: "user+handler",
  limit: 60,
  windowSeconds: 300,
} as const;
export const USER_CODE_TTL_SECONDS = 600;
// client_id is public, so anyone can start pairings; open requests are capped per address and overall.
export const MAX_OPEN_REQUESTS_PER_IP = 3;
export const MAX_OPEN_REQUESTS_TOTAL = 1000;
export const PAIRING_STARTS_PER_MINUTE = 10;
export const PAIRING_FLOOD_RETRY_AFTER_SECONDS = 60;
// An admin's confirmation can land just before a code expires; the waiting device still collects its token.
export const APPROVED_REDEEM_GRACE_SECONDS = 600;
// Confirming needs a check by the same admin this recently, so a prefilled link cannot skip the check step.
export const CODE_CHECK_VALID_SECONDS = 300;
export const POLL_INTERVAL_SECONDS = 5;
export const SLOW_DOWN_INCREMENT_SECONDS = 5;
export const HEARTBEAT_MIN_INTERVAL_MINUTES = 5;
export const DEFAULT_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const HEARTBEAT_MAX_BODY_BYTES = 4096;
export const UPLOAD_RATE_LIMIT = { limit: 600, windowSeconds: 60 } as const;
export const HEARTBEAT_RATE_LIMIT = { limit: 60, windowSeconds: 60 } as const;
export const RELATIVE_PATH_MAX_LENGTH = 1024;

export const DEFAULT_CONNECTORS_BASE_PATH = "/connectors";

export const ConnectorScreens = {
  list: "connector-list",
  pair: "connector-pair",
  confirm: "connector-confirm",
} as const;

export const ConnectorHandlers = {
  checkDevice: "connectors:write:check-device",
  approveDevice: "connectors:write:approve-device",
  revoke: "connectors:write:revoke",
  deviceStart: "connectors:write:device-start",
  devicePoll: "connectors:write:device-poll",
  claimAuthorization: "connectors:write:claim-authorization",
  markChecked: "connectors:write:mark-device-checked",
  revokeDeviceTokens: "connectors:write:revoke-device-tokens",
  touchDevice: "connectors:write:touch-device",
  receiveFile: "connectors:write:receive-file",
} as const;

export const ConnectorQueries = {
  list: "connectors:query:list",
  resolveDevice: "connectors:query:resolve-device",
  listDevices: "connectors:query:list-devices",
  pendingRequest: "connectors:query:pending-request",
  resolvePendingAuthorization: "connectors:query:resolve-pending-authorization",
} as const;

export const ConnectorErrors = {
  invalidUserCode: "invalid_user_code",
  connectorNotFound: "connector_not_found",
  connectorRevoked: "connector_revoked",
  uploadNotPrepared: "upload_not_prepared",
} as const;
