import type { DispatcherError, FieldIssue } from "@cosmicdrift/kumiko-headless";

// The server returns failure envelopes whose shape is nearly — but not
// exactly — DispatcherError. Kumiko's error-contract (see
// packages/framework/src/errors/) ships `code`, `httpStatus`, `i18nKey`,
// `message`, optional `i18nParams`, `details`, `requestId`, `timestamp`.
// DispatcherError is the client's trimmed view: timestamp is irrelevant
// for rendering, the rest maps 1:1. This module keeps the mapping in one
// place so a server-contract change (new field, renamed key) surfaces
// here with a typed error.

// Server's failure envelope, as serialized over JSON.
type ServerErrorInfo = {
  readonly code: string;
  readonly httpStatus: number;
  readonly i18nKey: string;
  readonly i18nParams?: Readonly<Record<string, unknown>>;
  readonly message: string;
  readonly details?: unknown;
  readonly docsUrl?: string;
  readonly requestId?: string;
  readonly timestamp?: string;
};

// Narrow cast into the DispatcherError shape. Pass-through for everything
// except `details.fields`, which we normalize: the server uses
// ValidationFieldIssue (path/code/i18nKey/params), which is structurally
// identical to FieldIssue — but we re-build it so a future field-addition
// on either side forces a compile error here, the right place to update.
export function mapServerError(serverError: ServerErrorInfo): DispatcherError {
  const normalizedDetails = normalizeDetails(serverError.details);
  return {
    code: serverError.code,
    httpStatus: serverError.httpStatus,
    i18nKey: serverError.i18nKey,
    message: serverError.message,
    ...(serverError.i18nParams && { i18nParams: serverError.i18nParams }),
    ...(normalizedDetails && { details: normalizedDetails }),
    ...(serverError.docsUrl && { docsUrl: serverError.docsUrl }),
    ...(serverError.requestId && { requestId: serverError.requestId }),
  };
}

function normalizeDetails(details: unknown): DispatcherError["details"] {
  if (!details || typeof details !== "object") return undefined;
  const d = details as Record<string, unknown>; // @cast-boundary error-details — generic über alle DispatcherError-shapes
  const fields = d["fields"];
  if (!Array.isArray(fields)) {
    // Details without fields still pass through — non-validation errors
    // (rate-limit, version-conflict, ...) carry their own structured
    // payload here.
    return d as DispatcherError["details"];
  }
  const mappedFields: FieldIssue[] = [];
  for (const f of fields) {
    if (!f || typeof f !== "object") {
      // Server sent a non-object entry in details.fields — contract
      // breach (ValidationFieldIssue shape is required). Warn so the
      // skip doesn't hide a broken server build.
      // biome-ignore lint/suspicious/noConsole: ops-visible warning when the server breaks the validation-error contract
      console.warn("[dispatcher-live] dropping malformed field issue (not an object):", f);
      continue;
    }
    const r = f as Record<string, unknown>; // @cast-boundary error-details
    if (
      typeof r["path"] !== "string" ||
      typeof r["code"] !== "string" ||
      typeof r["i18nKey"] !== "string"
    ) {
      // Entry is an object but missing required keys — same reasoning.
      // biome-ignore lint/suspicious/noConsole: ops-visible warning when the server breaks the validation-error contract
      console.warn("[dispatcher-live] dropping malformed field issue (missing keys):", r);
      continue;
    }
    mappedFields.push({
      path: r["path"],
      code: r["code"],
      i18nKey: r["i18nKey"],
      ...(r["params"] !== undefined && {
        params: r["params"] as Readonly<Record<string, unknown>>,
      }),
    });
  }
  return { ...d, fields: mappedFields };
}

// Builds a DispatcherError for a failure that never reached the server —
// network dropped, DNS error, CORS block, fetch() threw. The UI should
// surface this differently (offline indicator, retry button) from a
// typed server-rejection; callers key off `code === "network_error"`.
export function buildNetworkError(cause: unknown): DispatcherError {
  const message = cause instanceof Error ? cause.message : String(cause ?? "network error");
  return {
    code: "network_error",
    // 0 is the JS fetch-failure convention (xhr.status is 0 on abort/fail
    // too). Distinguishes network from typed 5xx server errors.
    httpStatus: 0,
    i18nKey: "dispatcher.errors.network",
    message,
  };
}

// Abort-specific error — used when the caller canceled via AbortSignal.
// Distinct code so a form submit that was cancelled because the user
// closed the modal doesn't toast "network error" (confusing).
export function buildAbortError(): DispatcherError {
  return {
    code: "aborted",
    httpStatus: 0,
    i18nKey: "dispatcher.errors.aborted",
    message: "request was aborted",
  };
}
