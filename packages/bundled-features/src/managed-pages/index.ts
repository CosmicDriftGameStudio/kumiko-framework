// A custom wrapLayout receives ready-escaped parts (see ManagedPagesWrapLayout). The helpers stay
// exported for layouts outside managed-pages; TENANT_CONTENT_ATTR marks the content container
// for the tenant CSS.
export {
  type BrandingTokens,
  brandingHeaderHtml,
  brandingStyleBlock,
  EMPTY_BRANDING,
  sanitizeTenantCss,
  TENANT_CONTENT_ATTR,
  tenantStyleBlock,
} from "../page-render/index.ts";
// BRANDING_QN: the qualified config-key names a consumer writes branding to
// (`config:write:set`) — single source for the `managed-pages:config:branding-*`
// strings, so apps + the per-tenant migration never hardcode them.
export { BRANDING_QN, MANAGED_PAGES_CSS_FEATURE, readBranding } from "./branding.ts";
export { MANAGED_PAGES_FEATURE } from "./constants.ts";
export { createManagedPagesCssFeature } from "./css-gate.ts";
export {
  createManagedPagesFeature,
  type ManagedPagesOptions,
  type ManagedPagesWrapLayout,
} from "./feature.ts";
export { type PageRow, pageEntity, pagesTable } from "./table.ts";
