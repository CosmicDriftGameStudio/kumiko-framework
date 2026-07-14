import { describe, expect, test } from "bun:test";
import { buildLandingPage, renderLanding, SAMPLE_PLANS } from "../feature";

describe("apex-landing: text-content seam", () => {
  test("uses the seeded block body when present", () => {
    const html = renderLanding({
      blocks: new Map([["index:hero.title", "Custom seeded headline"]]),
      plans: SAMPLE_PLANS,
    });
    expect(html).toContain("Custom seeded headline");
    expect(html).not.toContain("Ship your roadmap, not your spreadsheet");
  });

  test("falls back to the baked-in default when the block is missing", () => {
    const page = buildLandingPage({ plans: SAMPLE_PLANS });
    const hero = page.sections.find((s) => s.kind === "hero");
    expect(hero?.kind === "hero" && hero.title).toBe("Ship your roadmap, not your spreadsheet");
  });
});

describe("apex-landing: tier-engine seam", () => {
  test("formats the paid price and per-month suffix from the plan config", () => {
    const html = renderLanding({ plans: SAMPLE_PLANS });
    expect(html).toContain("12.00 €");
    expect(html).toContain("/month");
  });

  test("renders the plan cap, and Infinity as unlimited", () => {
    const html = renderLanding({ plans: SAMPLE_PLANS });
    expect(html).toContain("3 projects");
    expect(html).toContain("50 projects");
    expect(html).toContain("Unlimited projects");
  });

  test("free and enterprise plans show no /month suffix", () => {
    const page = buildLandingPage({ plans: SAMPLE_PLANS });
    const pricing = page.sections.find((s) => s.kind === "pricing-grid");
    if (pricing?.kind !== "pricing-grid") throw new Error("no pricing section");
    const free = pricing.tiers.find((t) => t.name === "Free");
    const ent = pricing.tiers.find((t) => t.name === "Enterprise");
    expect(free?.priceSuffix).toBeUndefined();
    expect(ent?.priceSuffix).toBeUndefined();
    expect(free?.amount).toBe("0 €");
    expect(ent?.amount).toBe("Let's talk");
  });

  test("marks the featured plan with a badge", () => {
    const page = buildLandingPage({ plans: SAMPLE_PLANS });
    const pricing = page.sections.find((s) => s.kind === "pricing-grid");
    if (pricing?.kind !== "pricing-grid") throw new Error("no pricing section");
    const pro = pricing.tiers.find((t) => t.name === "Pro");
    expect(pro?.featured).toBe(true);
    expect(pro?.badge).toBe("Popular");
  });
});

describe("apex-landing: GEO/AEO schema.org JSON-LD", () => {
  test("renders an @graph with Organization + WebPage nodes", () => {
    const html = renderLanding({ plans: SAMPLE_PLANS });
    expect(html).toContain('<script type="application/ld+json">');
    expect(html).toContain('"@type":"Organization"');
    expect(html).toContain('"@type":"WebPage"');
    expect(html).toContain('"name":"Tasklane"');
  });

  test("WebPage node picks up the seeded meta.title block", () => {
    const html = renderLanding({
      blocks: new Map([["index:meta.title", "Custom SEO Title"]]),
      plans: SAMPLE_PLANS,
    });
    expect(html).toContain('"name":"Custom SEO Title"');
  });
});

describe("apex-landing: hero screenshot + lightbox", () => {
  test("hero includes shot-frame and apex lightbox chrome", () => {
    const html = renderLanding({ plans: SAMPLE_PLANS });
    expect(html).toContain('class="shot-frame"');
    expect(html).toContain("/screenshots/hero-app.png");
    expect(html).toContain('<dialog id="apex-lightbox"');
  });
});
