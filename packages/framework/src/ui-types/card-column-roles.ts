export const CARD_META_MAX = 3;

export type CardRoleColumn = {
  readonly field: string;
  readonly highlighted?: boolean;
  readonly type?: string;
  readonly renderer?: unknown;
  readonly hideOnNarrow?: boolean;
  readonly fileDisplay?: { readonly kind: string };
};

export type CardColumnRoles<C extends CardRoleColumn> = {
  readonly image: C | undefined;
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
  const title = textColumns.find((col) => col.highlighted === true) ?? textColumns[0];
  const status = textColumns.find(
    (col) => col !== title && col.type === "select" && col.renderer === undefined,
  );
  const meta = textColumns.filter(
    (col) => col !== title && col !== status && col.hideOnNarrow !== true,
  );
  return { image, title, status, meta };
}
