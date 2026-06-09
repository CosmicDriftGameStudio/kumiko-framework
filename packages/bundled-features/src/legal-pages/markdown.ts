import { escapeHtml, escapeHtmlAttr } from "@cosmicdrift/kumiko-headless";
import { Marked } from "marked";

// Markdown→HTML mit eigener `marked`-Instance. GFM aus, breaks aus —
// Legal-Pages sind strukturiert genug dass GFM-Tables/Strikethrough/
// Task-Lists nicht nötig sind. Headers + Listen + Links + Code reichen.
//
// Instance statt globaler `marked.setOptions()` damit andere Features
// die `marked` als runtime-dep nutzen ihre eigenen Optionen behalten —
// modul-level side-effect auf shared library wäre brittle bei mehreren
// Konsumenten.
//
// XSS-Schutz: marked rendered tags 1:1, also kann ein böswilliger Text-
// Editor (TenantAdmin) <script>-Tags reinschreiben. Aktuell akzeptiert
// weil nur trusted Roles (TenantAdmin/SystemAdmin) Texte setzen können —
// bei einem Multi-Author-Setup müsste DOMPurify oder isomorphic-dompurify
// dazu. Dokumentiert in README, Phase-2-Hardening.
const markdownRenderer = new Marked({
  gfm: false,
  breaks: false,
});

export function renderMarkdownToHtml(markdown: string): string {
  // @cast-boundary render-helper marked.parse return-type ist
  // `string | Promise<string>` — mit `{ async: false }` runtime-garantiert
  // sync (string). Cast nur API-Vertragsfix, kein Type-Loss.
  return markdownRenderer.parse(markdown, { async: false }) as string;
}


