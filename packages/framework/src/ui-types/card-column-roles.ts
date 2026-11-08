export const CARD_META_MAX = 3;

export type CardRoleColumn = {
  readonly field: string;
  readonly highlighted?: boolean;
  readonly type?: string;
  readonly renderer?: unknown;
  readonly hideOnNarrow?: boolean;
  readonly narrowInline?: boolean;
  readonly cardBadge?: boolean;
  readonly fileDisplay?: { readonly kind: string };
  /** A "to do" hint column: never the default card title. */
  readonly hint?: unknown;
  /** Leads the card like a hint column; covers computed columns, which need a renderer and so cannot take `hint`. */
  readonly emphasis?: boolean;
};

export type CardColumnRoles<C extends CardRoleColumn> = {
  readonly image: C | undefined;
  /** The "to do" sentence shown above the title. */
  readonly lead: C | undefined;
  readonly title: C | undefined;
  readonly status: C | undefined;
  readonly meta: readonly C[];
};

// An explicit `{ format: "image" | "file" }` renderer wins over the field type, the
// same precedence as the list view model's file display.
export function cardFileDisplayKind(
  type: string | undefined,
  renderer: unknown,
): "image" | "file" | undefined {
  if (typeof renderer === "object" && renderer !== null && "format" in renderer) {
    if (renderer.format === "image") return "image";
    if (renderer.format === "file") return "file";
  }
  if (type === "image" || type === "images") return "image";
  if (type === "file" || type === "files") return "file";
  return undefined;
}

// One rule for the narrow-layout list card, shared by the renderer and the
// boot validator so the validator counts exactly what the card would draw.
// The first image column is the card's leading preview, neither title nor meta.
export function cardColumnRoles<C extends CardRoleColumn>(
  columns: readonly C[],
): CardColumnRoles<C> {
  const isImage = (col: C): boolean => col.fileDisplay?.kind === "image";
  const image = columns.find((col) => isImage(col) && col.hideOnNarrow !== true);
  // A narrow-hidden image must not turn into the title just because it is not the preview.
  const textColumns = columns.filter(
    (col) => col !== image && !(isImage(col) && col.hideOnNarrow === true),
  );
  // A column the phone hides cannot be the card title.
  const titleCandidates = textColumns.filter((col) => col.hideOnNarrow !== true);
  const isLeadCandidate = (col: C): boolean => col.hint !== undefined || col.emphasis === true;
  const title =
    titleCandidates.find((col) => col.highlighted === true) ??
    titleCandidates.find((col) => !isLeadCandidate(col)) ??
    titleCandidates[0];
  const status =
    textColumns.find(
      (col) => col !== title && col.cardBadge === true && col.hideOnNarrow !== true,
    ) ??
    textColumns.find((col) => col !== title && col.type === "select" && col.renderer === undefined);
  const lead = textColumns.find(
    (col) => col !== title && col !== status && isLeadCandidate(col) && col.hideOnNarrow !== true,
  );
  const meta = textColumns.filter(
    (col) => col !== title && col !== status && col !== lead && col.hideOnNarrow !== true,
  );
  return { image, lead, title, status, meta };
}

// A run of consecutive `narrowInline` columns shares one line; every other column has its own.
export function cardMetaLines<C extends CardRoleColumn>(
  meta: readonly C[],
): readonly (readonly C[])[] {
  const lines: C[][] = [];
  let previousWasInline = false;
  for (const col of meta) {
    const inline = col.narrowInline === true;
    const last = lines[lines.length - 1];
    if (inline && previousWasInline && last !== undefined) last.push(col);
    else lines.push([col]);
    previousWasInline = inline;
  }
  return lines;
}
