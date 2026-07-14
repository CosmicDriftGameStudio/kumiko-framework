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
});
