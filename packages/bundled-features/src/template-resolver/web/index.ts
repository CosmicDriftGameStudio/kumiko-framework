// Public exports for the browser side of template-resolver. Consumed through
// the sub-path export `@cosmicdrift/kumiko-bundled-features/template-resolver/web`
// — the server side (defineFeature) lives in
// `@cosmicdrift/kumiko-bundled-features/template-resolver` and has no React or
// DOM deps.

export { textBlocksClient } from "./client-plugin.tsx";
export type { EditableTemplateKind } from "./constants.ts";
export { COMPANY_PLACEHOLDERS, MAX_SELECTED_TEMPLATES } from "./constants.ts";
export { DocumentContentEditor } from "./document-editor.tsx";
export {
  DOCUMENT_FONT_LABELS,
  DOCUMENT_FONT_PRINT_STACKS,
  DOCUMENT_FONTS,
  type DocumentFont,
} from "./document-fonts.ts";
export type { DocumentFrameControl } from "./document-frame-control.ts";
export {
  COLWIDTH_PX_RANGE,
  type DocumentFrameAttributes,
  type DocumentFramePreset,
  FRAME_MM_RANGE,
  FRAME_PRESETS,
  LINE_HEIGHT_RANGE,
  PARAGRAPH_SPACE_PT_RANGE,
  TEXT_SIZE_PT_RANGE,
} from "./document-print-style.ts";
export {
  type DocumentBlockStyle,
  type DocumentFrameBox,
  type DocumentTextStyle,
  documentBlockStyleCss,
  documentCellStyleCss,
  documentFrameCss,
  documentTextStyleCss,
} from "./document-style-css.ts";
export { FONT_SIZES_PT } from "./document-tiptap-helpers.ts";
export {
  type DocumentEditorChrome,
  type DocumentEditorHandle,
  type DocumentEditorProps,
  type DocumentLayoutValues,
  type DocumentPrintBlock,
  type DocumentPrintMode,
  type DocumentResourcePreview,
  type DocumentToolbarBlock,
  MAIL_DOCUMENT_BLOCKS,
  PDF_DOCUMENT_BLOCKS,
} from "./document-toolbar-blocks.ts";
export { MAIL_TONES, type MailTone } from "./mail-constants.ts";
export {
  HEX_COLOR_PATTERN,
  MAIL_LAYOUT_ACCENT_LINES,
  MAIL_LAYOUT_BUTTON_STYLES,
  MAIL_LAYOUT_FONTS,
  MAIL_LAYOUT_WIDTHS,
} from "./mail-layout-constants.ts";
export {
  PDF_DEFAULT_FONT_SIZE_PT,
  PDF_DEFAULT_MARGIN_MM,
  PDF_FOOTER_MARGIN_MM,
  PDF_HEADER_MARGIN_MM,
  PDF_ORIENTATIONS,
  PDF_PAGE_FORMATS,
  PDF_TABLE_STYLES,
  type PdfTableStyle,
} from "./pdf-constants.ts";
export {
  PlaceholderLineEditor,
  type PlaceholderLineEditorProps,
} from "./placeholder-line-editor-lazy.tsx";
export { previewTargetOfKind } from "./preview-targets.ts";
export {
  TemplateResolverErrors,
  TemplateResolverHandlers,
  TemplateResolverQueries,
} from "./qualified-names.ts";
export { WebPreviewRenderer } from "./web-preview-renderer.tsx";
