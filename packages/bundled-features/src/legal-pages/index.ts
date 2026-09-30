export {
  LEGAL_OPTIONAL_BLOCKS,
  LEGAL_PAGES_FEATURE,
  LEGAL_REQUIRED_BLOCKS,
  LEGAL_ROUTES,
  type LegalPageRoute,
  LegalPagesErrors,
  type LegalRequiredBlock,
} from "./constants.js";
export {
  createLegalPagesFeature,
  type LegalPagesBootCheckCtx,
  type LegalPagesOptions,
  runLegalPagesBootCheck,
} from "./feature.js";
export { renderMarkdownToHtml, wrapInLayout } from "./markdown.js";
