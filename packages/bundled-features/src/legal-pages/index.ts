export {
  createLegalPagesFeature,
  type LegalPagesBootCheckCtx,
  type LegalPagesOptions,
  runLegalPagesBootCheck,
} from "./feature.ts";
export { createLegalPagesLayout, type LegalPagesLayoutOptions } from "./layout.ts";
export { renderMarkdownToHtml, wrapInLayout } from "./markdown.ts";
export {
  type LegalContentBlock,
  type LegalContentSeedFn,
  type LegalContentSeedSource,
  legalContentSeed,
} from "./seed.ts";
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
} from "./web/constants.ts";
