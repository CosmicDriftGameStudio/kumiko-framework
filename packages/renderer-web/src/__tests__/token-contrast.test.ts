import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dir, "../styles.css"), "utf8");

// Balanced-brace body of the block that starts at `header`. The token blocks
// contain no nested braces, but comments may, so scan from the opening brace.
function blockBody(header: string): string {
  const start = css.indexOf(header);
  if (start === -1) throw new Error(`block not found: ${header}`);
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`unbalanced block: ${header}`);
}

function parseHexTokens(body: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const m of body.matchAll(/(--color-[a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    tokens.set(m[1] ?? "", m[2] ?? "");
  }
  return tokens;
}

function channelLuminance(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) =>
    channelLuminance(Number.parseInt(hex.slice(i, i + 2), 16)),
  );
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

const MIN_CONTRAST = 4.5;
const STATUS_TONES = ["ok", "warn", "bad", "critical", "neutral"] as const;

const themes = {
  dark: parseHexTokens(blockBody("@theme {")),
  // Light overrides only what differs; everything else is inherited from @theme.
  light: new Map([
    ...parseHexTokens(blockBody("@theme {")),
    ...parseHexTokens(blockBody(":root:not(.dark)")),
  ]),
};

function pairs(): ReadonlyArray<readonly [text: string, surface: string]> {
  const surfaces = ["card", "background", "muted"];
  const textOnSurfaces = ["foreground", "foreground-secondary", "muted-foreground"].flatMap(
    (text) => surfaces.map((surface) => [text, surface] as const),
  );
  return [
    ...textOnSurfaces,
    ["primary-foreground", "primary"],
    ["destructive-foreground", "destructive"],
    ["sidebar-foreground", "sidebar"],
    ["sidebar-muted", "sidebar"],
    ["sidebar-muted", "sidebar-input"],
    ["sidebar-accent-foreground", "sidebar-accent"],
    ["sidebar-primary-foreground", "sidebar-primary"],
    ...STATUS_TONES.map((tone) => [`status-${tone}`, `status-${tone}-surface`] as const),
  ];
}

describe("WCAG contrast of the design tokens", () => {
  test("the parser sees a complete token set in both themes", () => {
    for (const tokens of Object.values(themes)) {
      for (const [text, surface] of pairs()) {
        expect(tokens.has(`--color-${text}`), text).toBe(true);
        expect(tokens.has(`--color-${surface}`), surface).toBe(true);
      }
    }
  });

  test("the contrast formula matches known reference values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  for (const [themeName, tokens] of Object.entries(themes)) {
    describe(themeName, () => {
      for (const [text, surface] of pairs()) {
        test(`${text} on ${surface} >= ${MIN_CONTRAST}:1`, () => {
          const ratio = contrastRatio(
            tokens.get(`--color-${text}`) ?? "",
            tokens.get(`--color-${surface}`) ?? "",
          );
          expect(ratio).toBeGreaterThanOrEqual(MIN_CONTRAST);
        });
      }
    });
  }
});
