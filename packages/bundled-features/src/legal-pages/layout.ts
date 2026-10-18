import { escapeHtml, escapeHtmlAttr } from "@cosmicdrift/kumiko-headless";
import { type PublicPageWrapLayout, TENANT_CONTENT_ATTR } from "../page-render/index.js";

export type LegalPagesLayoutOptions = {
  // Appended to the page title as "<title> · <siteName>".
  readonly siteName: string;
  // Trusted app CSS, inlined into one <style> block.
  readonly css?: string;
  readonly stylesheetHrefs?: readonly string[];
  // Trusted app chrome per language; the feature passes the route's `lang`.
  readonly headerHtml?: (lang: string) => string;
  readonly footerHtml?: (lang: string) => string;
  readonly contentClass?: string;
};

export function createLegalPagesLayout(options: LegalPagesLayoutOptions): PublicPageWrapLayout {
  const stylesheets = (options.stylesheetHrefs ?? [])
    .map((href) => `\n<link rel="stylesheet" href="${escapeHtmlAttr(href)}">`)
    .join("");
  // html-ok: css comes from app code (LegalPagesLayoutOptions), never from tenant or user input.
  const style = options.css ? `\n<style>${options.css}</style>` : "";
  const contentClass = options.contentClass
    ? ` class="${escapeHtmlAttr(options.contentClass)}"`
    : "";
  return ({ title, bodyHtml, lang }) => {
    const headerHtml = options.headerHtml?.(lang) ?? "";
    const footerHtml = options.footerHtml?.(lang) ?? "";
    return `<!doctype html>
<html lang="${escapeHtmlAttr(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · ${escapeHtml(options.siteName)}</title>
<meta name="robots" content="index,follow">${stylesheets}${style}
</head>
<body>
${headerHtml}
<main ${TENANT_CONTENT_ATTR}${contentClass}>
${bodyHtml}
</main>
${footerHtml}
</body>
</html>`;
  };
}
