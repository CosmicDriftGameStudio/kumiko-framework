// Render-boundary primitives for a custom wrapLayout. The `branding` it
// receives is RAW, untrusted tenant input: `title`/`description` are only
// length-capped at write (NOT HTML-escaped), and `customCss` is unsanitized.
// Emit them only through these helpers, which escape/sanitize at the boundary:
//   • `brandingHeaderHtml(branding)` / `brandingStyleBlock(branding)` — escaped
//     logo/title header + scoped `:root` theme vars (the default skeleton uses
//     these). Hand-rolling `<h1>${branding.title}</h1>` instead is stored XSS.
//   • `tenantStyleBlock(branding.customCss)` — the scope-baked, allowlist-
//     sanitized, contained `<style>` block; wrap content in `TENANT_CONTENT_ATTR`.
//     `sanitizeTenantCss` is the low-level escape hatch (you supply the scope).
export {
  type BrandingTokens,
  brandingHeaderHtml,
  brandingStyleBlock,
  EMPTY_BRANDING,
  sanitizeTenantCss,
  TENANT_CONTENT_ATTR,
  tenantStyleBlock,
} from "../page-render";
// BRANDING_QN: the qualified config-key names a consumer writes branding to
// (`config:write:set`) — single source for the `managed-pages:config:branding-*`
// strings, so apps + the per-tenant migration never hardcode them.
export { BRANDING_QN, MANAGED_PAGES_CSS_FEATURE } from "./branding";
export { createManagedPagesCssFeature } from "./css-gate";
export {
  createManagedPagesFeature,
  type ManagedPagesOptions,
  type ManagedPagesWrapLayout,
} from "./feature";
export { type PageRow, pageEntity, pagesTable } from "./table";
