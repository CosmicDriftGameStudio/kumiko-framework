export type RobotsPolicy = {
  readonly allow: boolean;
  readonly sitemapUrl?: string;
  /** Emit explicit Allow rules for known AI crawlers (GPTBot, ClaudeBot,
   *  anthropic-ai, PerplexityBot, Google-Extended). No-op when allow:false —
   *  a blanket Disallow already covers every bot. */
  readonly aiCrawlers?: boolean;
  /** Raw value for the Content-Signal directive (contentsignals.org), e.g.
   *  "ai-train=no, search=yes, ai-input=yes". Emitted verbatim. */
  readonly contentSignal?: string;
};

const AI_CRAWLER_USER_AGENTS = [
  "GPTBot",
  "ClaudeBot",
  "anthropic-ai",
  "PerplexityBot",
  "Google-Extended",
] as const;

// Only used when an app opts into GET /robots.txt (SeoOptions.robotsPolicy) —
// the common case (no per-host logic) is already covered by dev-server's
// static public/robots.txt passthrough.
export function buildRobotsTxt(policy: RobotsPolicy): string {
  const rule = policy.allow ? "Disallow:" : "Disallow: /";
  const aiCrawlerBlocks =
    policy.aiCrawlers && policy.allow
      ? AI_CRAWLER_USER_AGENTS.map((ua) => `\nUser-agent: ${ua}\nAllow: /`).join("")
      : "";
  const contentSignal = policy.contentSignal ? `\nContent-Signal: ${policy.contentSignal}` : "";
  const sitemap = policy.sitemapUrl ? `\nSitemap: ${policy.sitemapUrl}` : "";
  return `User-agent: *\n${rule}${aiCrawlerBlocks}${contentSignal}${sitemap}\n`;
}
