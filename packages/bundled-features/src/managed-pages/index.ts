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
export { MANAGED_PAGES_FEATURE } from "./constants.ts";
export {
  type ApexTenantResolver,
  createManagedPagesFeature,
  type ManagedPagesOptions,
  type ManagedPagesWrapLayout,
} from "./feature.ts";
export { type PageRow, pageEntity, pagesTable } from "./table.ts";
export { PAGE_UPDATE_HANDLER } from "./web/constants.ts";
