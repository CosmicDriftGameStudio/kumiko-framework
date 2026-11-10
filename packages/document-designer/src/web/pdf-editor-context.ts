import type { usePrimitives } from "@cosmicdrift/kumiko-renderer";
import type { Translate } from "@cosmicdrift/kumiko-renderer/headless";
import type { PdfActions } from "./pdf-editor-actions.ts";
import type { EditorState } from "./pdf-editor-draft.ts";
import type { PdfView } from "./pdf-editor-view.ts";
import type { TemplateDetail } from "./types.ts";
import type { PdfEditorState } from "./use-pdf-editor-state.ts";

type Primitives = ReturnType<typeof usePrimitives>;

export type PdfRenderContext = {
  readonly t: Translate;
  readonly Button: Primitives["Button"];
  readonly Dialog: Primitives["Dialog"];
  readonly slug: string;
  readonly s: PdfEditorState;
  readonly actions: PdfActions;
  readonly view: PdfView;
  readonly current: EditorState;
  readonly detail: TemplateDetail;
  readonly onLocaleChange: ((locale: string) => void) | undefined;
  readonly exportBundle: () => Promise<void>;
  /** Undefined when no client feature registers the template-import action. */
  readonly startTemplateImport: (() => void) | undefined;
};
