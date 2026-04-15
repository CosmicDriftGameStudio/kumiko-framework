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
}

export function isKumikoError(e: unknown): e is KumikoError {
  return e instanceof KumikoError;
}
