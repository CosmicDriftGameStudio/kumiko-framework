// resolveMatrixViewports — the per-project viewport selection runMatrix uses
// to decide, given the running Playwright project and the full project list,
// whether it's a device project (single native-size screenshot, no
// setViewportSize) or the desktop pass (loops the remaining viewport ids).
//
// Lives outside src/e2e/ on purpose — bunfig.toml excludes **/e2e/**
// from bun test (that tree is Playwright .spec.ts territory).

import { describe, expect, test } from "bun:test";
import {
  type MatrixProjectInfo,
  resolveLocaleTag,
  resolveMatrixViewports,
  type ViewportId,
} from "../e2e/screenshots";

const ALL_VIEWPORTS: readonly ViewportId[] = ["desktop", "tablet", "mobile"];

describe("resolveMatrixViewports", () => {
  test("without device projects, the desktop pass keeps every viewport", () => {
    const projects: MatrixProjectInfo[] = [{ name: "chromium", isMobile: false }];
    const plan = resolveMatrixViewports("chromium", false, projects, ALL_VIEWPORTS);
    expect(plan).toEqual({ mode: "desktop", viewports: ["desktop", "tablet", "mobile"] });
  });

  test("with tablet and mobile device projects, each captures only its own viewport", () => {
    const projects: MatrixProjectInfo[] = [
      { name: "chromium", isMobile: false },
      { name: "tablet", isMobile: true },
      { name: "mobile", isMobile: true },
    ];
    expect(resolveMatrixViewports("tablet", true, projects, ALL_VIEWPORTS)).toEqual({
      mode: "device",
      viewports: ["tablet"],
    });
    expect(resolveMatrixViewports("mobile", true, projects, ALL_VIEWPORTS)).toEqual({
      mode: "device",
      viewports: ["mobile"],
    });
  });

  test("with tablet and mobile device projects, the desktop pass only keeps desktop", () => {
    const projects: MatrixProjectInfo[] = [
      { name: "chromium", isMobile: false },
      { name: "tablet", isMobile: true },
      { name: "mobile", isMobile: true },
    ];
    const plan = resolveMatrixViewports("chromium", false, projects, ALL_VIEWPORTS);
    expect(plan).toEqual({ mode: "desktop", viewports: ["desktop"] });
  });

  test("a device project filtered out by SCREENSHOT_VIEWPORTS is skipped with a reason", () => {
    const projects: MatrixProjectInfo[] = [
      { name: "chromium", isMobile: false },
      { name: "tablet", isMobile: true },
    ];
    const plan = resolveMatrixViewports("tablet", true, projects, ["desktop"]);
    expect(plan.mode).toBe("skip");
    expect(plan.mode === "skip" && plan.reason).toContain('"tablet"');
  });

  test("the desktop pass respects the SCREENSHOT_VIEWPORTS filter too", () => {
    const projects: MatrixProjectInfo[] = [{ name: "chromium", isMobile: false }];
    const plan = resolveMatrixViewports("chromium", false, projects, ["desktop", "mobile"]);
    expect(plan).toEqual({ mode: "desktop", viewports: ["desktop", "mobile"] });
  });

  test("a mobile project whose name isn't a ViewportId (e.g. offlot's \"phone\") writes under its own subtree, fixed to the mobile viewport", () => {
    const projects: MatrixProjectInfo[] = [
      { name: "chromium", isMobile: false },
      { name: "phone", isMobile: true },
    ];
    const plan = resolveMatrixViewports("phone", true, projects, ALL_VIEWPORTS);
    expect(plan).toEqual({ mode: "namedDevice", viewports: ["mobile"], outputPrefix: "phone" });
  });

  test("a non-mobile project that isn't a ViewportId runs the desktop pass", () => {
    const projects: MatrixProjectInfo[] = [{ name: "chromium", isMobile: false }];
    const plan = resolveMatrixViewports("chromium", false, projects, ALL_VIEWPORTS);
    expect(plan).toEqual({ mode: "desktop", viewports: ["desktop", "tablet", "mobile"] });
  });
});

describe("resolveLocaleTag", () => {
  test("en/de use the hand-picked defaults", () => {
    expect(resolveLocaleTag("en", undefined)).toBe("en-US");
    expect(resolveLocaleTag("de", undefined)).toBe("de-DE");
  });

  test("an app-supplied localeTags entry overrides the default", () => {
    expect(resolveLocaleTag("en", { en: "en-GB" })).toBe("en-GB");
  });

  test("a locale with no default and no override falls back to Intl.Locale derivation", () => {
    expect(resolveLocaleTag("es", undefined)).toBe("es-ES");
  });

  test("throws when neither a default nor a derivable region exists", () => {
    expect(() => resolveLocaleTag("zz", undefined)).toThrow(/no BCP47 tag/);
  });
});
