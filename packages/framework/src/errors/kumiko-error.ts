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

// Default-Doku-URL für Self-Service-Errors. Kann via env-var
// `KUMIKO_DOCS_URL` überschrieben werden — z.B. für Self-Hosted-Kunden
// die ihre eigene Doku-Instanz hosten.
const DEFAULT_DOCS_BASE_URL = "https://docs.kumiko.so";

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

  // Doku-URL für Self-Service. Pro-Reason-Slug aus `details.reason` wenn
  // vorhanden (z.B. ConflictError → "stale_state"), sonst Fallback auf
  // den Error-Code (z.B. "not_found", "validation_error"). Default-Renderer
  // im Client zeigt "Mehr erfahren →" Link auf diese URL.
  get docsUrl(): string {
    return `${docsBaseUrl()}/errors/${this.reasonSlug}`;
  }

  private get reasonSlug(): string {
    if (this.details && typeof this.details === "object") {
      const r = (this.details as Record<string, unknown>)["reason"];
      if (typeof r === "string") return r;
    }
    return this.code;
  }
}

export function isKumikoError(e: unknown): e is KumikoError {
  return e instanceof KumikoError;
}
