import { describe, expect, test } from "bun:test";
import { renderWelcomeBanner } from "../welcome-banner";

describe("renderWelcomeBanner", () => {
  test("includes URL + admin login + features dir + docs link", () => {
    const banner = renderWelcomeBanner({
      url: "http://localhost:3000",
      admin: { email: "admin@demo.test", password: "changeme" },
    });
    expect(banner).toContain("http://localhost:3000");
    expect(banner).toContain("admin@demo.test");
    expect(banner).toContain("changeme");
    expect(banner).toContain("src/features/");
    expect(banner).toContain("docs.kumiko.rocks");
  });

  test("box rows are aligned (all the same printable width)", () => {
    const banner = renderWelcomeBanner({
      url: "http://localhost:3000",
      admin: { email: "a@b.c", password: "x" },
    });
    const rows = banner.split("\n");
    const widths = rows.map((r) => [...r].length);
    expect(new Set(widths).size).toBe(1);
  });

  test("admin is optional (no-auth dev runs still get a banner)", () => {
    const banner = renderWelcomeBanner({ url: "http://localhost:3000" });
    expect(banner).toContain("http://localhost:3000");
    expect(banner).not.toContain("Login als");
  });

  test("featuresDir + docsUrl overridable", () => {
    const banner = renderWelcomeBanner({
      url: "http://localhost:3000",
      featuresDir: "app/modules/",
      docsUrl: "https://internal.example.com/dev",
    });
    expect(banner).toContain("app/modules/");
    expect(banner).toContain("internal.example.com/dev");
  });
});
