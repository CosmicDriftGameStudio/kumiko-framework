// Plain, JSON-serializable snapshot of a KumikoError for use on the write-path
// (WriteResult.error, BatchResult.error). The dispatcher stores results under
// an idempotency key — a KumikoError instance wouldn't round-trip through
// JSON, so we keep structural data only and rebuild the instance on demand
// via reraiseAsKumikoError when we need to throw upstream again.
export type WriteErrorInfo = {
  readonly code: string;
  readonly httpStatus: number;
  readonly i18nKey: string;
  readonly i18nParams?: Readonly<Record<string, unknown>>;
  readonly message: string;
  readonly details?: unknown;
};

// The failure half of WriteResult — `{ isSuccess: false } + error`. Named
// so the write-failure factories in write-error-info.ts and WriteResult
// share one shape instead of restating it. Not generic: the error carries
// zero data, so there's nothing for the caller to narrow.
export type WriteFailure = {
  readonly isSuccess: false;
  readonly error: WriteErrorInfo;
};
