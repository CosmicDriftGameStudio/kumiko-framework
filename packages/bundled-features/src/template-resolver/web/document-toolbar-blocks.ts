// @runtime client
import type { ContentEditorProps } from "@cosmicdrift/kumiko-renderer";

export type DocumentToolbarBlock =
  | "image"
  | "table"
  | "button"
  | "divider"
  | "repeat"
  | "pageBreak";

export type DocumentEditorProps = ContentEditorProps & {
  readonly blocks?: readonly DocumentToolbarBlock[];
};

export const MAIL_DOCUMENT_BLOCKS = [
  "image",
  "table",
  "button",
  "divider",
  "repeat",
] as const satisfies readonly DocumentToolbarBlock[];

export const PDF_DOCUMENT_BLOCKS = [
  "image",
  "table",
  "divider",
  "repeat",
  "pageBreak",
] as const satisfies readonly DocumentToolbarBlock[];
