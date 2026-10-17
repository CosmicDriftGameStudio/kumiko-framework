// @runtime client
import type { ContentEditorProps } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";

export type DocumentToolbarBlock =
  | "image"
  | "table"
  | "button"
  | "divider"
  | "repeat"
  | "pageBreak"
  | "align"
  | "steps";

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
  /** Canvas only: wraps the editable area in a caller-owned page (letterhead, margins) instead of the default mail paper. */
  readonly renderPaper?: (editable: ReactNode) => ReactNode;
  /** Canvas only: renders the toolbar (and its insert panel) into this element instead of above the editor;
   *  null renders none. Lets several region editors share one toolbar that follows the focused one. */
  readonly toolbarHost?: HTMLElement | null;
  /** Called with the handle once the editor exists and with null when it is destroyed (unmount or rebuild), so a held handle never outlives its editor. */
  readonly onEditorReady?: (handle: DocumentEditorHandle | null) => void;
};

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
  "pageBreak",
] as const satisfies readonly DocumentToolbarBlock[];

/** Block set for a template-resource kind; every kind except "document-pdf" gets the mail set. */
export function documentBlocksForKind(kind: string | undefined): readonly DocumentToolbarBlock[] {
  return kind === "document-pdf" ? PDF_DOCUMENT_BLOCKS : MAIL_DOCUMENT_BLOCKS;
}
