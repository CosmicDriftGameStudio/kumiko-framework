import type { KumikoError } from "./kumiko-error.ts";
import { AgentReasons, FrameworkReasons } from "./reasons.ts";

const DEFAULT_DOCS_BASE_URL = "https://docs.kumiko.rocks";
const REASON_SLUG_RE = /^[a-z0-9_.-]+$/;

/** Links an app's own error reasons to its own docs; uncovered reasons fall back to the framework page of the error code. */
export type ErrorDocsConfig = {
  readonly baseUrl: string;
  readonly reasons?: readonly string[] | "all";
};

const frameworkReasons: ReadonlySet<string> = new Set([
  ...Object.values(FrameworkReasons),
  ...Object.values(AgentReasons),
]);

// Codes of the built-in error classes: only these have a framework docs page.
const frameworkErrorCodes: ReadonlySet<string> = new Set([
  "validation_error",
  "feature_disabled",
  "access_denied",
  "unauthenticated",
  "not_found",
  "conflict",
  "version_conflict",
  "precondition_failed",
  "record_locked",
  "idempotent_replay",
  "unique_violation",
  "unprocessable",
  "unconfigured",
  "internal_error",
  "member_read_timeout",
  "rate_limited",
  "rate_limit_unavailable",
]);

function reasonOf(err: KumikoError): string | undefined {
  if (!err.details || typeof err.details !== "object") return undefined;
  // @cast-boundary error-details — per-error typed details; reflection shape only for the reason lookup.
  const reason = (err.details as Record<string, unknown>)["reason"];
  return typeof reason === "string" && REASON_SLUG_RE.test(reason) ? reason : undefined;
}

function isCoveredByConfig(reason: string, errorDocs: ErrorDocsConfig | undefined): boolean {
  if (!errorDocs) return false;
  return errorDocs.reasons === "all" || (errorDocs.reasons?.includes(reason) ?? false);
}

function errorsUrl(baseUrl: string, slug: string): string {
  return `${baseUrl}/errors/${encodeURIComponent(slug)}`;
}

// A reason the framework documents (or no reason, or the code itself) links to the framework docs, overridable via
// KUMIKO_DOCS_URL. An app's own reason links to the app docs where `errorDocs` covers it; every
// other reason falls back to the framework page of the error code, unless an app subclass overrode the code.
export function resolveErrorDocsUrl(
  err: KumikoError,
  errorDocs?: ErrorDocsConfig,
): string | undefined {
  const reason = reasonOf(err);
  const frameworkBaseUrl = process.env["KUMIKO_DOCS_URL"] ?? DEFAULT_DOCS_BASE_URL;
  if (reason === undefined || reason === err.code || frameworkReasons.has(reason)) {
    return errorsUrl(frameworkBaseUrl, reason ?? err.code);
  }
  if (errorDocs && isCoveredByConfig(reason, errorDocs)) {
    return errorsUrl(errorDocs.baseUrl, reason);
  }
  return frameworkErrorCodes.has(err.code) ? errorsUrl(frameworkBaseUrl, err.code) : undefined;
}
