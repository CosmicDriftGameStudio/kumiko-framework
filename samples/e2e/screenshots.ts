import { mkdirSync, statSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { pinEnglishLocale } from "./pin-english-locale";

// Geteilte Screenshot-Runner für den samples-Cluster (workspace-lokal, nicht
// published). Standalone-Apps (money-horse/publicstatus/show-pony) pinnen
// publishtes kumiko → sie folgen nur der Konvention und kopieren die Vorlage.
//
// runScreenshots: ein Bild pro Szenario → <outDir>/<name>.png.
// runMatrix: jedes Szenario × Locale × Theme × Viewport in EINEM Lauf →
//   <baseDir>/<name>/<locale>/<theme>/<viewport>.png (bedient den Preview-Switcher).
//
// Beide sind Registrars: am Modul-Top der Spec aufrufen, NICHT awaiten — sonst
// registrieren sie test() erst nach der Playwright-Collection (0 Tests).

const MIN_BYTES = 5 * 1024;

export interface Scenario {
  readonly name: string;
  readonly description?: string;
  readonly url?: string;
  readonly flow?: (page: Page) => Promise<void>;
  readonly waitFor?: string;
  readonly settleMs?: number;
  readonly fullPage?: boolean;
  readonly viewport?: { readonly width: number; readonly height: number };
}

async function openScenario(page: Page, s: Scenario): Promise<void> {
  if (s.flow) await s.flow(page);
  else if (s.url) await page.goto(s.url);
  else throw new Error(`Scenario "${s.name}" needs either url or flow`);

  if (s.waitFor) {
    await expect(page.locator(s.waitFor).first()).toBeVisible({ timeout: 10_000 });
  }
  if (s.settleMs) await page.waitForTimeout(s.settleMs);
}

export interface FlatOptions {
  readonly outDir: string;
  readonly pinLocale?: boolean;
}

// Fail at registration time, not mid-run: a url-only scenario with no
// waitFor races the page's own render (screenshot fires before content
// settles); a scenario with neither url nor flow throws inside openScenario
// anyway, but only once Playwright actually runs that test — catching it
// here surfaces every broken scenario in one pass instead of one per run.
export function validateScenarios(scenarios: readonly Scenario[]): void {
  for (const s of scenarios) {
    if (s.flow === undefined && s.url === undefined) {
      throw new Error(`Scenario "${s.name}" needs either url or flow`);
    }
    if (s.flow === undefined && s.waitFor === undefined) {
      throw new Error(
        `Scenario "${s.name}" uses url without waitFor — the screenshot would race the page's ` +
          `own render. Set waitFor to a selector that's only present once the page is ready.`,
      );
    }
  }
}

export function runScreenshots(scenarios: readonly Scenario[], opts: FlatOptions): void {
  validateScenarios(scenarios);
  mkdirSync(opts.outDir, { recursive: true });
  for (const s of scenarios) {
    test(s.description ? `${s.name} — ${s.description}` : s.name, async ({ page }) => {
      if (opts.pinLocale) await pinEnglishLocale(page);
      if (s.viewport) await page.setViewportSize(s.viewport);
      await openScenario(page, s);
      const path = `${opts.outDir}/${s.name}.png`;
      await page.screenshot({ path, fullPage: s.fullPage ?? false });
      expect.soft(statSync(path).size).toBeGreaterThan(MIN_BYTES);
    });
  }
}

const VIEWPORTS = {
  desktop: { width: 1280, height: 900 },
  tablet: { width: 834, height: 1112 },
  mobile: { width: 390, height: 844 },
} as const;
type ViewportId = keyof typeof VIEWPORTS;

// Achse aus Env einengen (CSV) oder Default nehmen. Filtert statt zu casten:
// ein Tippfehler in der Env-Var (z.B. SCREENSHOT_VIEWPORTS=typo) würde sonst
// entweder zur Laufzeit crashen (page.setViewportSize(undefined)) oder,
// schlimmer, lautlos falsche Screenshots erzeugen (applyTheme mit unbekanntem
// Theme-Wert togglet einfach nichts).
function axis<T extends string>(env: string | undefined, all: readonly T[]): readonly T[] {
  const picked = env
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!picked || picked.length === 0) return all;
  // ponytail: filter-instead-of-cast — unbekannte Werte werden still ignoriert
  return picked.filter((p): p is T => (all as readonly string[]).includes(p));
}

export interface MatrixOptions<T extends string> {
  readonly baseDir: string;
  readonly themes: readonly T[];
  readonly applyTheme: (page: Page, theme: T) => Promise<void>;
  readonly locales?: readonly string[];
}

export function runMatrix<T extends string>(
  scenarios: readonly Scenario[],
  opts: MatrixOptions<T>,
): void {
  validateScenarios(scenarios);

  const locales = axis(process.env["SCREENSHOT_LOCALES"], opts.locales ?? ["en", "de"]);
  const themes = axis(process.env["SCREENSHOT_THEMES"], opts.themes);
  const viewports = axis(
    process.env["SCREENSHOT_VIEWPORTS"],
    Object.keys(VIEWPORTS) as ViewportId[],
  );
  const only = process.env["SCREENSHOT_ONLY"];

  test.describe.configure({ mode: "serial" });

  for (const locale of locales) {
    for (const s of scenarios) {
      if (only !== undefined && only !== s.name) continue;
      test(`${locale} — ${s.name}`, async ({ page }) => {
        // kumiko:locale steuert die Boot-Sprache (vor goto); kumiko:theme löschen,
        // damit der Mode allein über applyTheme bestimmt wird.
        await page.addInitScript((lng) => {
          localStorage.setItem("kumiko:locale", lng);
          localStorage.removeItem("kumiko:theme");
        }, locale);
        await openScenario(page, s);

        for (const theme of themes) {
          await opts.applyTheme(page, theme);
          for (const vp of viewports) {
            await page.setViewportSize(VIEWPORTS[vp]);
            await page.waitForTimeout(150); // Reflow nach Viewport-Wechsel
            const dir = `${opts.baseDir}/${s.name}/${locale}/${theme}`;
            mkdirSync(dir, { recursive: true });
            const path = `${dir}/${vp}.png`;
            // animations: "disabled" wirkt auf Engine-Ebene (springt laufende
            // Transitions/Animationen sofort auf den Endstate) — immun gegen
            // CSS-Spezifität, anders als eine addStyleTag-Injektion.
            await page.screenshot({ path, fullPage: s.fullPage ?? false, animations: "disabled" });
            expect.soft(statSync(path).size).toBeGreaterThan(MIN_BYTES);
          }
        }
      });
    }
  }
}
