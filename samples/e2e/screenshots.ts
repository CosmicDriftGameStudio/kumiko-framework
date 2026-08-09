import { mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
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

// The two themes every sample app renders out of the box: renderer-web's
// light default and its `.dark` variant. Apps with extra themes (styleguide's
// brand-token override) pass their own pair to runMatrix.
export const DEFAULT_THEMES = ["default-light", "default-dark"] as const;
export type DefaultThemeId = (typeof DEFAULT_THEMES)[number];

export async function applyDefaultTheme(page: Page, theme: DefaultThemeId): Promise<void> {
  await page.evaluate((t) => {
    document.documentElement.classList.toggle("dark", t === "default-dark");
  }, theme);
}

// Docs preview root for sample-app matrices: <docs>/public/screenshots/samples/
// <bucket>/<app>/<scenario>/<locale>/<theme>/<viewport>.png. The docgen derives
// the same path from the recipe's directory, so no name mapping is needed.
export function docsSampleDir(specDirname: string, sampleDirPath: string): string {
  return (
    process.env["SCREENSHOT_DIR"] ??
    resolve(
      specDirname,
      "../../../../../kumiko-platform/apps/docs/public/screenshots/samples",
      sampleDirPath,
    )
  );
}

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
  // Browser-context locale for JS-side Intl/navigator.language (e.g. money-input's
  // resolvedLocale) — pinEnglishLocale() only seeds the app's own kumiko:locale.
  // ponytail: native <input type="number"> still formats per the host OS region,
  // unreachable from Playwright (context.locale and --lang both no-op there). #1851
  if (opts.pinLocale) test.use({ locale: "en-US" });
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
  // 1920×1080 statt der frueheren 1280×900: die Masken landen im Handbuch und
  // in Doku-Seiten, wo ein 1280er-Bild auf einem HiDPI-Display sichtbar weich
  // wird. Breiter zeigt ausserdem, was ein Zwei-Spalten-Layout wirklich tut —
  // bei 1280 sieht jede Liste neben einem Lesebereich gequetscht aus.
  desktop: { width: 1920, height: 1080 },
  // iPad-Querformat (Landscape) statt Portrait: swap der iPad-Pro-11"-Maße.
  tablet: { width: 1112, height: 834 },
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
  const matched = picked.filter((p): p is T => (all as readonly string[]).includes(p));
  if (matched.length === 0) {
    throw new Error(
      `axis(): env filter "${env}" matched none of [${all.join(", ")}] — 0 registered tests.`,
    );
  }
  return matched;
}

export interface MatrixOptions<T extends string> {
  readonly baseDir: string;
  readonly themes: readonly T[];
  readonly applyTheme: (page: Page, theme: T) => Promise<void>;
  readonly locales?: readonly string[];
}

// App locale codes ("en"/"de") -> BCP47 tags for Playwright's browser-context
// `locale` option, pinning JS-side Intl/navigator.language regardless of the
// host's own locale — without it, a screenshot regen on a non-en-US host bakes
// in the host's Intl-driven formatting regardless of SCREENSHOT_LOCALES.
const LOCALE_TAGS: Readonly<Record<string, string>> = { en: "en-US", de: "de-DE" };

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
    test.describe(locale, () => {
      // Browser-context locale for JS-side Intl/navigator.language — the
      // kumiko:locale seed below only drives the app's own i18n strings.
      // ponytail: native <input type="number"> still formats per the host OS
      // region, unreachable from Playwright (context.locale and --lang both
      // no-op there). #1851
      test.use({ locale: LOCALE_TAGS[locale] ?? locale });

      for (const s of scenarios) {
        if (only !== undefined && only !== s.name) continue;
        test(s.name, async ({ page }) => {
          // kumiko:locale drives the boot-time language (before goto); kumiko:theme
          // is cleared so the mode is decided solely by applyTheme.
          await page.addInitScript((lng) => {
            localStorage.setItem("kumiko:locale", lng);
            localStorage.removeItem("kumiko:theme");
          }, locale);
          await openScenario(page, s);

          for (const theme of themes) {
            await opts.applyTheme(page, theme);
            for (const vp of viewports) {
              await page.setViewportSize(VIEWPORTS[vp]);
              await page.waitForTimeout(150); // reflow after viewport change
              const dir = `${opts.baseDir}/${s.name}/${locale}/${theme}`;
              mkdirSync(dir, { recursive: true });
              const path = `${dir}/${vp}.png`;
              // animations: "disabled" jumps to end-state at the engine level — immune to CSS specificity, unlike an addStyleTag injection.
              await page.screenshot({
                path,
                fullPage: s.fullPage ?? false,
                animations: "disabled",
              });
              expect.soft(statSync(path).size).toBeGreaterThan(MIN_BYTES);
            }
          }
        });
      }
    });
  }
}
