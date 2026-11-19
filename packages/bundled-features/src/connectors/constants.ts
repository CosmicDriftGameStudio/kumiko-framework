// Names the browser bundle needs too: they live under web/, which the runtime-isolation guard classes as client code, so server and client import the same values.
export {
  ConnectorHandlers,
  ConnectorQueries,
  ConnectorScreens,
  FILE_NAME_CELL_COMPONENT,
} from "./web/client-constants.ts";

export const CONNECTORS_FEATURE = "connectors";
export const CONNECTOR_ENTITY = "connector";
export const INBOUND_ITEM_ENTITY = "inbound-item";
export const INBOUND_FOLDER_ENTITY = "inbound-folder";

export const CONNECTOR_KIND = { satellite: "satellite" } as const;
export const CONNECTOR_STATUS = { active: "active", revoked: "revoked" } as const;
export type ConnectorStatus = (typeof CONNECTOR_STATUS)[keyof typeof CONNECTOR_STATUS];

export const DEVICE_AUTHORIZATION_STATUS = {
  pending: "pending",
  approved: "approved",
} as const;

// A device-code request can name any client_id; the satellite sends this fixed one.
export const CONNECTOR_CLIENT_ID = "kumiko-satellite";
export const DEVICE_TOKEN_PREFIX = "ksat_";
export const DEVICE_TOKEN_PATTERN = /^ksat_[A-Za-z0-9_-]{20,200}$/;

// The preview asks once per typed character, so it gets more room than the confirm attempts.
export const CODE_ATTEMPT_RATE_LIMIT = {
  per: "user+handler",
  limit: 20,
  windowSeconds: 300,
} as const;

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

export const SYNC_STATE = { idle: "idle", syncing: "syncing", error: "error" } as const;
export type SyncState = (typeof SYNC_STATE)[keyof typeof SYNC_STATE];
// What the list shows; derived from the reported state and counts.
export const SYNC_STATUS = {
  unknown: "unknown",
  synced: "synced",
  syncing: "syncing",
  failed: "failed",
} as const;
export const DEFAULT_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
// Per tenant, over all connectors: one misbehaving satellite must not fill the file store.
export const DEFAULT_MAX_STORED_BYTES_PER_TENANT = 5 * 1024 * 1024 * 1024;

// Windows and macOS system files a satellite must never deliver (matched per path segment, lower case).
export const BALLAST_PATH_SEGMENTS: readonly string[] = [
  "$recycle.bin",
  "system volume information",
  "thumbs.db",
  "desktop.ini",
  ".ds_store",
  "pagefile.sys",
  "hiberfil.sys",
  "swapfile.sys",
];
// Office lock files ("~$Angebot.docx").
export const BALLAST_PATH_PREFIXES: readonly string[] = ["~$"];
export const HEARTBEAT_MAX_BODY_BYTES = 4096;
export const UPLOAD_RATE_LIMIT = { limit: 600, windowSeconds: 60 } as const;
export const HEARTBEAT_RATE_LIMIT = { limit: 60, windowSeconds: 60 } as const;
export const RELATIVE_PATH_MAX_LENGTH = 1024;
// Deep chains and long names only inflate the folder tree; a real file share stays far below both.
export const MAX_FOLDER_DEPTH = 20;
export const MAX_FOLDER_NAME_LENGTH = 255;
// A folder id is a 36-character uuid plus its slash, one per ancestor.
export const ID_PATH_MAX_LENGTH = (MAX_FOLDER_DEPTH + 1) * 37 + 1;
// Files listed per page; the folder deletion job removes this many per batch.
export const FILES_PAGE_SIZE = 100;
export const FOLDER_DELETE_BATCH_SIZE = 100;
// ponytail: the search decrypts and scans names, so it stops after this many and says `truncated`; a searchable name index would need plaintext, which the PII rules rule out.
export const MAX_SEARCH_NAMES = 20_000;
export const MAX_SEARCH_HITS = 100;
export const MIN_SEARCH_TERM_LENGTH = 2;

// Generations of one derived id (a folder name, a delivered file) that were deleted; far above any real share.
export const MAX_ID_GENERATIONS = 50;

export const DEFAULT_CONNECTORS_BASE_PATH = "/connectors";

export const ConnectorErrors = {
  invalidUserCode: "invalid_user_code",
  connectorNotFound: "connector_not_found",
  connectorRevoked: "connector_revoked",
  uploadNotPrepared: "upload_not_prepared",
  storageQuotaExceeded: "storage_quota_exceeded",
} as const;
