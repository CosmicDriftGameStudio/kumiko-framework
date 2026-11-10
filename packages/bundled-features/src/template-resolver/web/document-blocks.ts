export type DocumentToolbarBlock =
  | "image"
  | "table"
  | "button"
  | "divider"
  | "repeat"
  | "pageBreak"
  | "align"
  | "steps"
  | "images";

export const MAIL_DOCUMENT_BLOCKS = [
  "image",
  "table",
  "button",
  "divider",
  "repeat",
  "steps",
] as const satisfies readonly DocumentToolbarBlock[];

export const PDF_DOCUMENT_BLOCKS = [
  "align",
  "image",
  "table",
  "divider",
  "repeat",
  "steps",
  "images",
  "pageBreak",
] as const satisfies readonly DocumentToolbarBlock[];

// A layout region has no per-document variables, so a steps block there could never show a stage and an images block no photos.
export const PDF_LAYOUT_DOCUMENT_BLOCKS = PDF_DOCUMENT_BLOCKS.filter(
  (block) => block !== "steps" && block !== "images",
);

/** Block set for a template-resource kind; every kind except "document-pdf" gets the mail set. */
export function documentBlocksForKind(kind: string | undefined): readonly DocumentToolbarBlock[] {
  return kind === "document-pdf" ? PDF_DOCUMENT_BLOCKS : MAIL_DOCUMENT_BLOCKS;
}
