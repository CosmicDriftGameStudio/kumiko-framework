import { escapeHtml, escapeHtmlAttr } from "@cosmicdrift/kumiko-headless";

// Minimaler HTML5-Skeleton mit Inline-CSS — Default-`wrapLayout` für
// server-gerenderte Public-Pages, damit sie auch ohne App-Layout sauber
// aussehen. Apps die ihr eigenes Marketing-Layout (Header/Footer/Theme)
// um den Body legen wollen, übergeben ihre eigene Render-Function.
export function wrapInLayout(opts: { title: string; bodyHtml: string; lang: string }): string {
  return `<!doctype html>
<html lang="${escapeHtmlAttr(opts.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 720px;
         margin: 2rem auto; padding: 0 1rem; line-height: 1.6; color: #222; }
  h1, h2, h3 { line-height: 1.2; margin-top: 2rem; }
  h1 { font-size: 1.8rem; } h2 { font-size: 1.4rem; } h3 { font-size: 1.15rem; }
  a { color: #0066cc; }
  code { background: #f4f4f4; padding: 0.1rem 0.3rem; border-radius: 3px; }
  hr { border: 0; border-top: 1px solid #ddd; margin: 2rem 0; }
</style>
</head>
<body>
<main>
${opts.bodyHtml}
</main>
</body>
</html>`;
}
