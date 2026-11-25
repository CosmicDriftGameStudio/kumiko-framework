/** Structured JSON display (audit payload/metadata, job logs, unsupported
 *  jsonb/embedded field fallback). Takes the raw value, not a pre-stringified
 *  one — the implementation owns `JSON.stringify` (and must not throw on
 *  circular refs / BigInt / other non-serializable input). `indent` mirrors
 *  `JSON.stringify`'s space-count param, default 2. */
export type JsonViewProps = {
  readonly value: unknown;
  readonly indent?: number;
  readonly testId?: string;
};

/** Read-only list of stored files (FileRef ids): name, download link and, for
 *  PDFs, an inline preview. Used for `renderer: { format: "file" }` on a detail field. */
export type FileValueListProps = {
  readonly fileIds: readonly string[];
  /** Starts the inline PDF preview of the newest file open; uploads append, so that is the last id. */
  readonly previewOpenByDefault?: boolean;
  /** Draws the download link as an outlined button (a field with actions beside it). */
  readonly downloadAsButton?: boolean;
  /** File icon and bold name on the left, the download button pushed to the right edge of the row. */
  readonly boxed?: boolean;
  readonly testId?: string;
};

/** Read-only name-value list: dimmed label on the left, value right-aligned in one column, evenly
 *  spaced rows. An `emphasize` row (a total) is bold with a rule above it. */
export type KeyValueListProps = {
  readonly rows: readonly {
    readonly key: string;
    readonly label: string;
    readonly value: string;
    readonly emphasize?: boolean;
  }[];
};
