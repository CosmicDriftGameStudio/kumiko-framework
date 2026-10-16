// @runtime client
import type { ContentEditorProps } from "@cosmicdrift/kumiko-renderer";

export type DocumentToolbarBlock =
  | "image"
  | "table"
  | "button"
  | "divider"
  | "repeat"
  | "pageBreak"
  | "align";

/** Imperative access for an outside panel (placeholder list, resource list). */
export type DocumentEditorHandle = {
  readonly insertPlaceholder: (name: string) => void;
  readonly insertResource: (key: string, alt?: string) => void;
  readonly focus: () => void;
};

export type DocumentResourcePreview = {
  /** Shown as the image source in the editor only; never written to the document. */
  readonly src: string;
  readonly caption?: string;
};

/** "default" keeps the compact bordered editor; "canvas" renders a flat text
 *  toolbar and a paper-like page with block labels. */
export type DocumentEditorChrome = "default" | "canvas";

export type DocumentEditorProps = ContentEditorProps & {
  readonly blocks?: readonly DocumentToolbarBlock[];
  /** Display label per variable name, as inserted (list item fields use the
   *  dotted form, e.g. "lines.description"). A chip shows label and name. */
  readonly variableLabels?: Readonly<Record<string, string>>;
  /** Variable names rendered as system chips (a different tint). */
  readonly systemVariables?: readonly string[];
  /** Image previews by resource key; resources without one show a key placeholder. */
  readonly resourcePreviews?: Readonly<Record<string, DocumentResourcePreview>>;
  readonly chrome?: DocumentEditorChrome;
  /** "compact" renders the placeholder and block buttons icon-only with a tooltip, for narrow columns. Default "full". */
  readonly toolbar?: "full" | "compact";
  /** Called with the handle once the editor exists and with null when it is destroyed. */
  readonly onEditorReady?: (handle: DocumentEditorHandle) => void;
};

export const MAIL_DOCUMENT_BLOCKS = [
  "image",
  "table",
  "button",
  "divider",
  "repeat",
] as const satisfies readonly DocumentToolbarBlock[];

export const PDF_DOCUMENT_BLOCKS = [
  "align",
  "image",
  "table",
  "divider",
  "repeat",
  "pageBreak",
] as const satisfies readonly DocumentToolbarBlock[];
