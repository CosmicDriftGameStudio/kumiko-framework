export { DEFAULT_MAIL_LAYOUT_MJML } from "./default-layout.js";
export {
  collectRegionResourceKeys,
  compileDocumentSource,
  createDocumentHandlebars,
  type DocumentFormat,
  mergeResourceFileRefs,
  readDocumentFormat,
  readTenantName,
  resolveResourceFileRefs,
} from "./document-kit.js";
export { createRendererMailHtmlFeature } from "./feature.js";
export type { MailFooter, MailFooterLink, MailFooterResolver } from "./mail-footer.js";
export { type MailHtmlRenderOptions, mailHtmlRender } from "./render.js";
