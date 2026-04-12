import type { ErrorCode } from "./constants";

const HTTP_STATUS: Record<string, number> = {
  handler_not_found: 404,
  access_denied: 403,
  field_access_denied: 403,
  validation_failed: 400,
  validation_hook: 400,
  version_conflict: 409,
  delete_restricted: 409,
};

export class FrameworkError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "FrameworkError";
    this.code = code;
  }

  get httpStatus(): number {
    return HTTP_STATUS[this.code] ?? 500;
  }
}
