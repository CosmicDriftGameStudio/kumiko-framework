export type RobotsPolicy = {
  readonly allow: boolean;
  readonly sitemapUrl?: string;
};

// Only used when an app opts into GET /robots.txt (SeoOptions.robotsPolicy) —
// the common case (no per-host logic) is already covered by dev-server's
// static public/robots.txt passthrough.
export function buildRobotsTxt(policy: RobotsPolicy): string {
  const rule = policy.allow ? "Disallow:" : "Disallow: /";
  const sitemap = policy.sitemapUrl ? `\nSitemap: ${policy.sitemapUrl}` : "";
  return `User-agent: *\n${rule}${sitemap}\n`;
}
