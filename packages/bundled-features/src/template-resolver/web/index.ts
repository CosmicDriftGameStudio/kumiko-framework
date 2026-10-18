// @runtime client
// Public exports for the browser side of template-resolver. Consumed through
// the sub-path export `@cosmicdrift/kumiko-bundled-features/template-resolver/web`
// — the server side (defineFeature) lives in
// `@cosmicdrift/kumiko-bundled-features/template-resolver` and has no React or
// DOM deps.

export { MAIL_TONES, type MailTone } from "../mail-constants.ts";
export {
  PDF_DEFAULT_MARGIN_MM,
  PDF_FOOTER_MARGIN_MM,
  PDF_HEADER_MARGIN_MM,
  PDF_ORIENTATIONS,
  PDF_PAGE_FORMATS,
} from "../pdf-constants.ts";
export {
  TemplateResolverErrors,
  TemplateResolverHandlers,
  TemplateResolverQueries,
} from "../qualified-names.ts";
export { textBlocksClient } from "./client-plugin.tsx";
export { DocumentContentEditor } from "./document-editor.tsx";
export {
  type DocumentEditorChrome,
  type DocumentEditorHandle,
  type DocumentEditorProps,
  type DocumentResourcePreview,
  type DocumentToolbarBlock,
  MAIL_DOCUMENT_BLOCKS,
  PDF_DOCUMENT_BLOCKS,
} from "./document-toolbar-blocks.ts";
export {
  PlaceholderLineEditor,
  type PlaceholderLineEditorProps,
} from "./placeholder-line-editor-lazy.tsx";
