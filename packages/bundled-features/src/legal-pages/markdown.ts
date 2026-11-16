// Re-export from the shared page-rendering core (managed pages use
// the same hardened renderer and default layout). Keep these names stable
// for legal-pages' public API (index.ts exports renderMarkdownToHtml and
// wrapInLayout).

export { renderSafeMarkdown as renderMarkdownToHtml, wrapInLayout } from "../page-render/index.ts";
