export {
  LEGAL_OPTIONAL_BLOCKS,
  LEGAL_PAGES_FEATURE,
  LEGAL_REQUIRED_BLOCKS,
  LEGAL_ROUTES,
  LEGAL_TERMS_ROUTES,
  type LegalPageRoute,
  LegalPagesErrors,
  type LegalRequiredBlock,
  legalPagePath,
} from "./constants.js";
export {
  createLegalPagesFeature,
  type LegalPagesBootCheckCtx,
  type LegalPagesOptions,
  runLegalPagesBootCheck,
} from "./feature.js";
export { createLegalPagesLayout, type LegalPagesLayoutOptions } from "./layout.js";
export { renderMarkdownToHtml, wrapInLayout } from "./markdown.js";
export {
  type LegalContentBlock,
  type LegalContentSeedFn,
  type LegalContentSeedSource,
  legalContentSeed,
} from "./seed.js";
