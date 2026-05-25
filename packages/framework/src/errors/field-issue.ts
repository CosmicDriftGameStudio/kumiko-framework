// Canonical per-field validation issue shape — shared between server-side
// ValidationError, Zod-bridge, and client-side DispatcherError.details.fields.
export type FieldIssue = {
  readonly path: string;
  readonly code: string;
  readonly i18nKey: string;
  readonly params?: Readonly<Record<string, unknown>>;
};

/** @deprecated Use `FieldIssue` — kept for existing imports. */
export type ValidationFieldIssue = FieldIssue;
