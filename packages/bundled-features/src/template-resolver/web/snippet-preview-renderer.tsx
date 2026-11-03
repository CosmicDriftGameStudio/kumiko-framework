import {
  type PreviewRenderer,
  type PreviewRendererProps,
  TextPreviewRenderer,
} from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { fillDocumentVariables } from "./fill-document-variables.ts";
import { stringValuesOf } from "./string-values.ts";
import { HtmlPaperFrame } from "./web-preview-renderer.tsx";

// The "text" target of collection entries: a document entry shows as the finished text with its
// example values. Collections are open to members who may not call the admin-only body preview, so
// nothing goes to the server: the filled HTML is shown in HtmlMailFrame, whose sandboxed,
// script-free iframe (CSP default-src 'none') is the protection. Other formats keep the renderer
// package's read-only text view.
export const SnippetPreviewRenderer: PreviewRenderer = (props: PreviewRendererProps): ReactNode => {
  if (props.editFormat !== "document") return <TextPreviewRenderer {...props} />;
  return (
    <HtmlPaperFrame
      html={fillDocumentVariables(props.content, stringValuesOf(props.variables))}
      devices={false}
    />
  );
};
