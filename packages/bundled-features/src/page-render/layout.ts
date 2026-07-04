import { escapeHtml, escapeHtmlAttr } from "@cosmicdrift/kumiko-headless";
import { type BrandingTokens, brandingHeaderHtml, brandingStyleBlock } from "./branding";
import { sanitizeTenantCss } from "./css-sanitize";

// Attribute marking the content container. The page body lives in
// `<main data-tenant-content>`; tenant custom CSS is scoped to its descendants
// and host containment clips its paint to this box. A custom wrapLayout that
// enables CSS-inject MUST put this attribute on the element wrapping the body
// (e.g. `<main ${TENANT_CONTENT_ATTR}>`) and emit `tenantStyleBlock(branding.
// customCss)` in <head> — otherwise tenant rules attach to nothing and the
// containment is absent. Exported so the attr and the helper's internal scope
// can't drift.
export const TENANT_CONTENT_ATTR = "data-tenant-content";
const TENANT_SCOPE = `[${TENANT_CONTENT_ATTR}]`;
// Host-controlled containment, emitted together with (and only alongside)
// tenant CSS. position+isolation box a tenant `position:absolute`/z-index to
// the container; overflow:hidden clips tenant paint (negative margins,
// transform, huge shadows, absolute children) off the host chrome. Tenant
// rules are scoped descendants (`[data-tenant-content] X`) and can't match the
// bare container, so they can't override either rule. No tenant CSS → neither
// is emitted → plain/legal pages render unclipped (normal overflow for wide
// tables/<pre>).
const TENANT_CONTAINMENT = `${TENANT_SCOPE}{position:relative;isolation:isolate}`;
const TENANT_CLIP = `${TENANT_SCOPE}{overflow:hidden}`;

// Render the per-tenant custom-CSS <style> block — the single emission path for
// the default skeleton below AND any custom wrapLayout. Returns "" when the
// input is empty or fully rejected (no element). Otherwise one `<style
// data-tenant-css>` carrying host containment + clip + the allowlist-sanitized,
// scope-prefixed tenant rules. Bakes in the scope so a caller can't mis-scope
// and silently lose containment; position:fixed/sticky are dropped upstream by
// the sanitizer.
export function tenantStyleBlock(customCss: string): string {
  const sanitized = sanitizeTenantCss(customCss, TENANT_SCOPE);
  if (!sanitized) return "";
  // html-ok: sanitizeTenantCss ist die Escaping-Boundary (Allowlist, strippt `<`).
  return `\n<style data-tenant-css>${TENANT_CONTAINMENT}\n${TENANT_CLIP}\n${sanitized}</style>`;
}

// Minimaler HTML5-Skeleton mit Inline-CSS — Default-`wrapLayout` für
// server-gerenderte Public-Pages, damit sie auch ohne App-Layout sauber
// aussehen. Apps die ihr eigenes Marketing-Layout (Header/Footer/Theme)
// um den Body legen wollen, übergeben ihre eigene Render-Function.
//
// Branding (optional): emittiert nach dem Base-`<style>` einen scoped
// `:root`-Override (Accent-Farbe, Layout-Preset → max-width) plus einen
// Logo-/Titel-Header. Alle Branding-Werte sind tenant-supplied + untrusted
// und werden in branding.ts re-validiert/escaped, bevor sie ins Markup gehen.
export function wrapInLayout(opts: {
  title: string;
  bodyHtml: string;
  lang: string;
  description?: string | null;
  branding?: BrandingTokens;
}): string {
  const themeStyleHtml = opts.branding ? brandingStyleBlock(opts.branding) : "";
  const header = opts.branding ? brandingHeaderHtml(opts.branding) : "";
  // Untrusted per-tenant CSS — scoped, allowlist-sanitized and host-contained
  // at the render boundary by tenantStyleBlock (same helper a custom wrapLayout
  // calls, so containment can't drift between the two paths). Empty/rejected →
  // no block, plain/legal pages keep normal overflow.
  const tenantStyle = tenantStyleBlock(opts.branding?.customCss ?? "");
  // Page description wins; the tenant's branding description is the site-wide
  // fallback when a page omits its own (keeps branding-description a live key).
  const description =
    opts.description && opts.description.length > 0
      ? opts.description
      : (opts.branding?.description ?? "");
  const metaDescription = description
    ? `\n<meta name="description" content="${escapeHtmlAttr(description)}">`
    : "";
  return `<!doctype html>
<html lang="${escapeHtmlAttr(opts.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)}</title>${metaDescription}
<style>
  :root { --accent: #0066cc; --page-max-width: 720px; }
  body { font-family: system-ui, -apple-system, sans-serif; max-width: var(--page-max-width);
         margin: 2rem auto; padding: 0 1rem; line-height: 1.6; color: #222; }
  h1, h2, h3 { line-height: 1.2; margin-top: 2rem; }
  h1 { font-size: 1.8rem; } h2 { font-size: 1.4rem; } h3 { font-size: 1.15rem; }
  a { color: var(--accent); }
  code { background: #f4f4f4; padding: 0.1rem 0.3rem; border-radius: 3px; }
  hr { border: 0; border-top: 1px solid #ddd; margin: 2rem 0; }
  .brand-header { position: relative; z-index: 1; display: flex; align-items: center;
                  gap: 0.6rem; margin-bottom: 1.5rem; }
  .brand-header a { display: flex; align-items: center; gap: 0.6rem; color: inherit; text-decoration: none; }
  .brand-logo { height: 2rem; width: auto; }
  .brand-title { font-weight: 600; font-size: 1.1rem; }
</style>${themeStyleHtml}${tenantStyle}
</head>
<body>
${header}
<main data-tenant-content>
${opts.bodyHtml}
</main>
</body>
</html>`;
}
