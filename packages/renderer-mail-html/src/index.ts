export { DEFAULT_MAIL_LAYOUT_MJML } from "./default-layout.ts";
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
} from "./document-kit.ts";
export { createRendererMailHtmlFeature } from "./feature.ts";
export type { MailFooter, MailFooterLink, MailFooterResolver } from "./mail-footer.ts";
export { MAIL_CHROME_EN } from "./mail-strings.ts";
export {
  type MailBrandSuffixResolver,
  type MailHtmlRenderOptions,
  type MailSiteUrlResolver,
  mailHtmlRender,
  readMailChrome,
} from "./render.ts";
