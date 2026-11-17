import type { PdfOptions } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import { postRender } from "./http-client.ts";
import { loadClientConfigOrUnavailable } from "./render.ts";

export type RenderHtmlToPdf = (html: string, options?: PdfOptions) => Promise<Uint8Array>;

export const renderHtmlToPdf: RenderHtmlToPdf = async (html, options = {}) => {
  const result = await postRender(loadClientConfigOrUnavailable(), {
    kind: "document-pdf",
    html,
    options,
  });
  return result.bytes;
};
