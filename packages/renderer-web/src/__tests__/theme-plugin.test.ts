import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildThemeCss, FRAMEWORK_COLOR_NAMES } from "../theme-plugin";

const STYLES_CSS = resolve(dirname(fileURLToPath(import.meta.url)), "../styles.css");

describe("buildThemeCss", () => {
  test("FRAMEWORK_COLOR_NAMES lists exactly the colors styles.css declares in @theme", async () => {
    const css = await readFile(STYLES_CSS, "utf8");
    const themeBlock = css.slice(
      css.indexOf("@theme {"),
      css.indexOf("\n}", css.indexOf("@theme {")),
    );
    const declared = [...themeBlock.matchAll(/--color-([a-z0-9-]+):/g)].map(
      (match) => match[1] ?? "",
    );
    expect(declared.sort()).toEqual([...FRAMEWORK_COLOR_NAMES].sort());
  });

  test("a plain color applies to both modes, a split color keeps dark apart, dark falls back to light", () => {
    const css = buildThemeCss({
      colors: {
        primary: "#0a7",
        background: { light: "#fff", dark: "#111" },
        card: { light: "#fafafa" },
      },
    });
    expect(css.light).toEqual({
      "--color-primary": "#0a7",
      "--color-background": "#fff",
      "--color-card": "#fafafa",
    });
    expect(css.dark).toEqual({
      "--color-primary": "#0a7",
      "--color-background": "#111",
      "--color-card": "#fafafa",
    });
  });

  test("only app-specific colors become extra utilities; framework colors already have them", () => {
    const css = buildThemeCss({ colors: { primary: "#0a7", "brand-soft": "#e0f5ee" } });
    expect(css.extraColorUtilities).toEqual({ "brand-soft": "var(--color-brand-soft)" });
  });

  test("radius, fonts, card shadow and card padding are mode-invariant; body font only with fonts.sans", () => {
    const withoutSans = buildThemeCss({ fonts: { heading: "Fraunces, serif" } });
    expect(withoutSans.bodyFontFamily).toBeUndefined();

    const css = buildThemeCss({
      radius: "0.75rem",
      fonts: { sans: "Inter, sans-serif", mono: "JetBrains Mono, monospace" },
      shadows: { card: "none" },
      spacing: { card: "1rem" },
    });
    expect(css.modeInvariant).toEqual({
      "--radius": "0.75rem",
      "--font-sans": "Inter, sans-serif",
      "--font-mono": "JetBrains Mono, monospace",
      "--card-shadow": "none",
      "--card-padding": "1rem",
    });
    expect(css.bodyFontFamily).toBe("var(--font-sans)");
  });

  test("a non-kebab color name fails at definition instead of emitting a broken variable", () => {
    expect(() => buildThemeCss({ colors: { brandSoft: "#e0f5ee" } })).toThrow(/kebab-case/);
  });
});
