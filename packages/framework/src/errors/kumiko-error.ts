// Base class for every error the framework recognizes as a contract.
// Anything that isn't a KumikoError is treated as an unexpected crash and
// auto-wrapped into InternalError by the dispatcher — so the HTTP layer never
// has to guess the status or the client-facing shape.

export type ErrorOpts = {
  readonly message?: string;
  readonly i18nKey?: string;
  readonly i18nParams?: Readonly<Record<string, unknown>>;
  readonly details?: unknown;
  readonly cause?: Error;
};

export type ErrorCtorInput = {
  readonly message: string;
  readonly i18nKey: string;
  readonly i18nParams?: Readonly<Record<string, unknown>>;
  readonly details?: unknown;
  readonly cause?: Error;
};

// Default docs URL for self-service errors. Override via `KUMIKO_DOCS_URL`
// (e.g. self-hosted customers pointing at their own docs instance).
const DEFAULT_DOCS_BASE_URL = "https://docs.kumiko.rocks";
const REASON_SLUG_RE = /^[a-z0-9_.-]+$/;

function docsBaseUrl(): string {
  return process.env["KUMIKO_DOCS_URL"] ?? DEFAULT_DOCS_BASE_URL;
}

export abstract class KumikoError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;
  readonly i18nKey: string;
  readonly i18nParams: Readonly<Record<string, unknown>> | undefined;
  readonly details: unknown;

  constructor(input: ErrorCtorInput) {
    super(input.message, input.cause ? { cause: input.cause } : undefined);
    this.name = new.target.name;
    this.i18nKey = input.i18nKey;
    this.i18nParams = input.i18nParams;
    this.details = input.details;
  }

  // Docs URL for self-service. Prefer a well-formed `details.reason` slug
  // (e.g. ConflictError → "stale_state"); otherwise fall back to the error
  // code. Encode the path segment so spaces/`../` in free-form reasons
  // cannot break or redirect the link the default renderer shows.
  get docsUrl(): string {
    return `${docsBaseUrl()}/errors/${encodeURIComponent(this.reasonSlug)}`;
  }

  private get reasonSlug(): string {
    if (this.details && typeof this.details === "object") {
      // @cast-boundary error-details — per-error typed details; reflection
      // shape only for the reasonSlug lookup.
      const r = (this.details as Record<string, unknown>)["reason"];
      if (typeof r === "string" && REASON_SLUG_RE.test(r)) return r;
    }
    return this.code;
  }
}

export function isKumikoError(e: unknown): e is KumikoError {
  return e instanceof KumikoError;
}
