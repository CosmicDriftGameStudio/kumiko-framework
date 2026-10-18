export { DEFAULT_MAIL_LAYOUT_MJML } from "./default-layout.js";
export {
  collectRegionResourceKeys,
  compileDocumentSource,
  createDocumentHandlebars,
  type DocumentFormat,
  mergeResourceFileRefs,
  readBrandingAccentColor,
  readDocumentFormat,
  readTenantName,
  resolveResourceFileRefs,
} from "./document-kit.js";
export { createRendererMailHtmlFeature } from "./feature.js";
export type { MailFooter, MailFooterLink, MailFooterResolver } from "./mail-footer.js";
export { MAIL_CHROME_EN } from "./mail-strings.js";
export {
  type MailBrandSuffixResolver,
  type MailHtmlRenderOptions,
  type MailSiteUrlResolver,
  mailHtmlRender,
  readMailChrome,
} from "./render.js";
