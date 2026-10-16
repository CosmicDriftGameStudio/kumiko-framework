// @runtime client
export {
  type DocumentDesignerClientOptions,
  documentDesignerClient,
  PdfTemplateEditorScreen,
} from "./client-plugin.js";
export { composeLayoutHtml, type LayoutRegionValues } from "./compose-layout.js";
export { documentDesignerTranslations } from "./i18n.js";
export { PdfTemplateEditor, type PdfTemplateEditorProps } from "./pdf-template-editor.js";
export { usageLabel, usedByLabel } from "./used-by-label.js";
