// Re-export aus dem geteilten page-render-Kern (managed-pages nutzt
// denselben gehärteten Renderer + Default-Layout). Namen bleiben stabil
// für legal-pages' Public-API (index.ts exportiert renderMarkdownToHtml +
// wrapInLayout).

export { wrapInLayout } from "../page-render/layout";
export { renderSafeMarkdown as renderMarkdownToHtml } from "../page-render/markdown";
