import { escapeXml } from "@cosmicdrift/kumiko-headless";

export type SitemapEntry = {
  readonly loc: string;
  /** ISO-8601 date/datetime. */
  readonly lastmod?: string;
  readonly changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  /** hreflang alternates for the same logical page (multilingual sitemaps). */
  readonly alternates?: readonly { readonly hreflang: string; readonly href: string }[];
  /** Human-/LLM-readable page title, used by llms.txt link lines. Falls back
   *  to `loc` when absent (callback-only entries rarely set this). */
  readonly title?: string;
};

// Pure XML builder — sitemaps.org urlset + xhtml:link alternates. No
// dedup/sort: callers control ordering, entries are trusted app/feature data
// (see feature.ts's trust boundary — same posture as ApexCta.href).
export function buildSitemapXml(entries: readonly SitemapEntry[]): string {
  const urls = entries
    .map((e) => {
      const lastmod = e.lastmod ? `\n    <lastmod>${escapeXml(e.lastmod)}</lastmod>` : "";
      const changefreq = e.changefreq ? `\n    <changefreq>${e.changefreq}</changefreq>` : "";
      const alternates = (e.alternates ?? [])
        .map(
          (a) =>
            `\n    <xhtml:link rel="alternate" hreflang="${escapeXml(a.hreflang)}" href="${escapeXml(a.href)}" />`,
        )
        .join("");
      return `  <url>\n    <loc>${escapeXml(e.loc)}</loc>${lastmod}${changefreq}${alternates}\n  </url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`;
}
