export const frameworkErrorHttpStatus = {
  validation_error: 400,
  feature_disabled: 403,
  access_denied: 403,
  unauthenticated: 401,
  not_found: 404,
  conflict: 409,
  version_conflict: 409,
  precondition_failed: 409,
  record_locked: 409,
  idempotent_replay: 409,
  unique_violation: 409,
  unprocessable: 422,
  unconfigured: 422,
  internal_error: 500,
  member_read_timeout: 504,
  rate_limited: 429,
  rate_limit_unavailable: 503,
} as const;

export type FrameworkErrorCode = keyof typeof frameworkErrorHttpStatus;
