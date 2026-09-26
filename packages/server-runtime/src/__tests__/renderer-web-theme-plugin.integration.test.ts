// The app theme plugin only works if its base-layer output lands AFTER the framework's light
// palette (`@layer base :root:not(.dark)`); same selector, same layer, so source order decides.
// This runs the real Tailwind one-shot over an app stylesheet that imports the framework CSS and
// loads a theme module through the published `theme-plugin` subpath.

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runTailwindOnce } from "../build-prod-bundle";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const FRAMEWORK_LIGHT_PRIMARY = "--color-primary:#171717";

function bunAvailable(): boolean {
  try {
    execFileSync("bun", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("renderer-web theme plugin in a real Tailwind build", () => {
  test.skipIf(!bunAvailable())(
    "app theme overrides the framework light palette, sets dark values and adds utilities for new colors",
    async () => {
      const dir = await mkdtemp(join(REPO_ROOT, ".theme-plugin-"));
      try {
        await writeFile(
          join(dir, "theme.ts"),
          `import { createThemePlugin, defineAppTheme } from "@cosmicdrift/kumiko-renderer-web/theme-plugin";
export default createThemePlugin(defineAppTheme({
  colors: {
    primary: { light: "#0a7d5a", dark: "#34d399" },
    "brand-soft": "#e0f5ee",
  },
  shadows: { card: "none" },
  fonts: { sans: "Manrope, sans-serif" },
}));
`,
        );
        await writeFile(
          join(dir, "probe.tsx"),
          `export const Probe = () => <div className="bg-brand-soft text-primary" />;\n`,
        );
        await writeFile(
          join(dir, "styles.css"),
          `@import "@cosmicdrift/kumiko-renderer-web/styles.css";\n@plugin "./theme.ts";\n@source "./probe.tsx";\n`,
        );

        const css = await runTailwindOnce(join(dir, "styles.css"), dir);

        const frameworkLight = css.indexOf(FRAMEWORK_LIGHT_PRIMARY);
        const appLight = css.indexOf("--color-primary:#0a7d5a");
        expect(frameworkLight).toBeGreaterThan(-1);
        expect(appLight).toBeGreaterThan(frameworkLight);

        expect(css).toMatch(/\.dark\{[^}]*--color-primary:#34d399/);
        expect(css).toMatch(/\.bg-brand-soft\{background-color:var\(--color-brand-soft\)\}/);

        const frameworkCardShadow = css.indexOf("--card-shadow:0 1px 3px");
        const appCardShadow = css.indexOf("--card-shadow:none");
        expect(frameworkCardShadow).toBeGreaterThan(-1);
        expect(appCardShadow).toBeGreaterThan(frameworkCardShadow);
        // An unlayered framework :root would beat the plugin's base layer despite the order.
        expect(css).toMatch(/:root\{[^}]*--kumiko-grid-row-h/);
        expect(css).not.toMatch(/:root\{[^}]*--kumiko-grid-row-h[^}]*--card-/);
        expect(css).not.toMatch(/:root\{[^}]*--card-[^}]*--kumiko-grid-row-h/);
        expect(css).toMatch(/body\{font-family:var\(--font-sans\)\}/);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
});
