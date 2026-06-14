import { escapeHtml, escapeHtmlAttr } from "@cosmicdrift/kumiko-headless";
import { type BrandingTokens, brandingHeaderHtml, brandingStyleBlock } from "./branding";

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
  const themeStyle = opts.branding ? brandingStyleBlock(opts.branding) : "";
  const header = opts.branding ? brandingHeaderHtml(opts.branding) : "";
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
  .brand-header { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 1.5rem; }
  .brand-header a { display: flex; align-items: center; gap: 0.6rem; color: inherit; text-decoration: none; }
  .brand-logo { height: 2rem; width: auto; }
  .brand-title { font-weight: 600; font-size: 1.1rem; }
</style>${themeStyle}
</head>
<body>
${header}
<main>
${opts.bodyHtml}
</main>
</body>
</html>`;
}
