import { type ErrorDocsConfig, resolveErrorDocsUrl } from "./docs-url.ts";
import type { KumikoError } from "./kumiko-error.ts";

// Wire format every 4xx/5xx response must match. The API routes use this
// verbatim; keep it stable — the client SDK keys off these field names.
//
// `docsUrl` is the deep-link for self-service: default web/mobile renderers
// show a "Mehr erfahren →" link pointing here. Computed from `details.reason`
// (when set) or fallback to `code`, even when `details` is stripped from the
// response (e.g. internal_error in production). An app's own reason not covered
// by `errorDocs` links to the framework page of its error code, unless the app
// overrode that code too (then there is no page and the field is absent).
export type ErrorResponseBody = {
  readonly error: {
    readonly code: string;
    readonly i18nKey: string;
    readonly i18nParams?: Readonly<Record<string, unknown>>;
    readonly message: string;
    readonly details?: unknown;
    readonly docsUrl?: string;
    readonly requestId?: string;
    readonly timestamp: string;
  };
};

// InternalError deliberately omits `details` from the response in production,
// because that field often carries the internal cause. The log still has
// everything (see buildErrorLog).
//
// In dev/test the cause is exposed in the response body to make debugging
// possible — without this, a crash in a handler comes back as a bare
// "internal error" and developers have to add try/catch + UnprocessableError
// just to see what went wrong (real footgun, not theoretical). The exposure
// is gated on NODE_ENV being explicitly "development" or "test": a missing or
// misspelled NODE_ENV (a misconfigured prod deploy) must not leak stack traces,
// paths or upstream URLs over the wire.
const CODES_WITHOUT_CLIENT_DETAILS = new Set(["internal_error"]);

export const exposesCauseDetails = (): boolean => {
  const env = process.env["NODE_ENV"];
  return env === "development" || env === "test";
};

// Snapshot of the cause chain (top-most error only) suitable for inclusion
// in dev-mode error responses. Stack is truncated to keep the body small.
type DevCauseDetail = {
  readonly causeName?: string;
  readonly causeMessage?: string;
  readonly causeStack?: string;
};

function devCauseDetail(cause: unknown): DevCauseDetail | undefined {
  if (!(cause instanceof Error)) return undefined;
  return {
    causeName: cause.name,
    causeMessage: cause.message,
    ...(cause.stack && { causeStack: cause.stack.split("\n").slice(0, 8).join("\n") }),
  };
}

export function serializeError(
  err: KumikoError,
  requestId?: string,
  errorDocs?: ErrorDocsConfig,
): ErrorResponseBody {
  const stripped = CODES_WITHOUT_CLIENT_DETAILS.has(err.code) && !exposesCauseDetails();
  const exposeDeclaredDetails = err.details !== undefined && !stripped;

  // For internal_error in dev/test, surface the cause chain so the
  // response body has something useful instead of "internal error".
  // Priority: declared details (if any) win over the cause snapshot —
  // a hand-set details on InternalError should not be replaced.
  const detailsForResponse = (() => {
    if (exposeDeclaredDetails) return err.details;
    if (CODES_WITHOUT_CLIENT_DETAILS.has(err.code) && exposesCauseDetails()) {
      return devCauseDetail(err.cause);
    }
    return undefined;
  })();

  const docsUrl = resolveErrorDocsUrl(err, errorDocs);
  return {
    error: {
      code: err.code,
      i18nKey: err.i18nKey,
      ...(err.i18nParams && { i18nParams: err.i18nParams }),
      message: err.message,
      ...(detailsForResponse !== undefined && { details: detailsForResponse }),
      ...(docsUrl !== undefined && { docsUrl }),
      ...(requestId && { requestId }),
      timestamp: new Date().toISOString(),
    },
  };
}
