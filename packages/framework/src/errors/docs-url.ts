import type { KumikoError } from "./kumiko-error.js";
import { AgentReasons, FrameworkReasons } from "./reasons.js";

const DEFAULT_DOCS_BASE_URL = "https://docs.kumiko.rocks";
const REASON_SLUG_RE = /^[a-z0-9_.-]+$/;

/** Links an app's own error reasons to its own docs; without it only framework reasons carry a docsUrl. */
export type ErrorDocsConfig = {
  readonly baseUrl: string;
  readonly reasons?: readonly string[] | "all";
};

const frameworkReasons: ReadonlySet<string> = new Set([
  ...Object.values(FrameworkReasons),
  ...Object.values(AgentReasons),
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

// A reason the framework documents (or the error code itself) links to the framework docs,
// overridable via KUMIKO_DOCS_URL. An app's own reason links only where `errorDocs` covers it —
// otherwise the framework docs would have no page for it.
export function resolveErrorDocsUrl(
  err: KumikoError,
  errorDocs?: ErrorDocsConfig,
): string | undefined {
  const reason = reasonOf(err);
  if (reason === undefined || reason === err.code || frameworkReasons.has(reason)) {
    const baseUrl = process.env["KUMIKO_DOCS_URL"] ?? DEFAULT_DOCS_BASE_URL;
    return errorsUrl(baseUrl, reason ?? err.code);
  }
  if (errorDocs && isCoveredByConfig(reason, errorDocs)) {
    return errorsUrl(errorDocs.baseUrl, reason);
  }
  return undefined;
}
