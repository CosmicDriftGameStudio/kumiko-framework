import { describe, expect, test } from "bun:test";
import { buildRobotsTxt } from "../robots-txt";

describe("buildRobotsTxt", () => {
  test("allow: true → no Disallow rule", () => {
    expect(buildRobotsTxt({ allow: true })).toBe("User-agent: *\nDisallow:\n");
  });

  test("allow: false → Disallow: /", () => {
    expect(buildRobotsTxt({ allow: false })).toBe("User-agent: *\nDisallow: /\n");
  });

  test("sitemapUrl appends a Sitemap line", () => {
    expect(buildRobotsTxt({ allow: true, sitemapUrl: "https://acme.test/sitemap.xml" })).toBe(
      "User-agent: *\nDisallow:\nSitemap: https://acme.test/sitemap.xml\n",
    );
  });

  test("aiCrawlers: true + allow: true → explicit Allow block per AI bot", () => {
    expect(buildRobotsTxt({ allow: true, aiCrawlers: true })).toBe(
      "User-agent: *\nDisallow:\n" +
        "User-agent: GPTBot\nAllow: /\n" +
        "User-agent: ClaudeBot\nAllow: /\n" +
        "User-agent: anthropic-ai\nAllow: /\n" +
        "User-agent: PerplexityBot\nAllow: /\n" +
        "User-agent: Google-Extended\nAllow: /\n",
    );
  });

  test("aiCrawlers: true + allow: false → no per-bot block (blanket Disallow already covers it)", () => {
    expect(buildRobotsTxt({ allow: false, aiCrawlers: true })).toBe("User-agent: *\nDisallow: /\n");
  });

  test("contentSignal appends a Content-Signal line", () => {
    expect(
      buildRobotsTxt({ allow: true, contentSignal: "ai-train=no, search=yes, ai-input=yes" }),
    ).toBe("User-agent: *\nDisallow:\nContent-Signal: ai-train=no, search=yes, ai-input=yes\n");
  });
});
