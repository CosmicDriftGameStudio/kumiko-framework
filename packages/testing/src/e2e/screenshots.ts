import { createHash } from "node:crypto";
import { mkdirSync, statSync } from "node:fs";
import { expect, type Page, type Request } from "@playwright/test";
import { pinEnglishLocale } from "./pin-english-locale";
import { requireScreenshotDir } from "./screenshot-dir";
import { type SeedTenantFixture, test } from "./seeded-tenant-fixture";

// runScreenshots: one image per scenario → $SCREENSHOT_DIR/<name>.png.
// runMatrix: every scenario × locale × theme × viewport in ONE run →
//   $SCREENSHOT_DIR/<name>/<locale>/<theme>/<viewport>.png (feeds the preview switcher).
//
// Both are registrars: call at the spec's module top, do NOT await — otherwise
// they register test() only after Playwright's collection pass (0 tests).
// SCREENSHOT_DIR is read when a registrar runs, never at import time.

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

export interface Scenario {
  readonly name: string;
  readonly description?: string;
  readonly url?: string;
  readonly flow?: (page: Page, fixtures: { seedTenant: SeedTenantFixture }) => Promise<void>;
  readonly waitFor?: string;
  readonly fullPage?: boolean;
  readonly viewport?: { readonly width: number; readonly height: number };
  // Runs after the viewport is set and the page has settled, right before the
  // screenshot. runMatrix calls this once per theme × viewport combination for
  // the scenario — it must be idempotent (e.g. hide/mask an element) rather
  // than a one-shot action like clicking a dismiss button, which would only
  // succeed on the first capture and time out on every one after.
  readonly beforeCapture?: (page: Page) => Promise<void>;
  // runMatrix only: opt out of the identical-theme-screenshot check for
  // scenarios that legitimately render the same pixels across themes — e.g.
  // a plain server-rendered content page with no client-side theme wiring.
  readonly themeInvariant?: boolean;
}

// EventSource (hot-reload, live events) has its own resource type, so a
// never-ending stream does not count as an in-flight data request.
const DATA_REQUEST_TYPES: ReadonlySet<string> = new Set(["fetch", "xhr"]);
const STABLE_POLLS = 2;

function countInFlightDataRequests(page: Page): () => number {
  const inFlight = new Set<Request>();
  const settle = (request: Request): void => {
    inFlight.delete(request);
  };
  page.on("request", (request) => {
    if (DATA_REQUEST_TYPES.has(request.resourceType())) inFlight.add(request);
  });
  page.on("requestfinished", settle);
  page.on("requestfailed", settle);
  return () => inFlight.size;
}

function pageFingerprint(): string {
  return [
    document.fonts.status,
    document.documentElement.scrollWidth,
    document.documentElement.scrollHeight,
    document.body.getElementsByTagName("*").length,
    document.getAnimations().filter((animation) => animation.playState === "running").length,
  ].join(":");
}

// Replaces fixed sleeps: settled = no data request in flight and an unchanged
// DOM/scroll-size/animation fingerprint over STABLE_POLLS consecutive polls.
async function waitForSettledPage(page: Page, inFlightDataRequests: () => number): Promise<void> {
  let previous: string | undefined;
  let stablePolls = 0;
  await expect
    .poll(
      async () => {
        const current = await page.evaluate(pageFingerprint);
        stablePolls = current === previous && inFlightDataRequests() === 0 ? stablePolls + 1 : 0;
        previous = current;
        return stablePolls;
      },
      {
        message: "page never settled (data requests in flight or DOM still changing)",
        intervals: [100],
      },
    )
    .toBeGreaterThanOrEqual(STABLE_POLLS);
}

async function openScenario(
  page: Page,
  s: Scenario,
  inFlightDataRequests: () => number,
  fixtures: { seedTenant: SeedTenantFixture },
): Promise<void> {
  if (s.flow) await s.flow(page, fixtures);
  else if (s.url) await page.goto(s.url);
  else throw new Error(`Scenario "${s.name}" needs either url or flow`);

  if (s.waitFor) {
    await expect(page.locator(s.waitFor).first()).toBeVisible({ timeout: 10_000 });
  }
  await waitForSettledPage(page, inFlightDataRequests);
}

export interface FlatOptions {
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

export function runScreenshots(scenarios: readonly Scenario[], opts: FlatOptions = {}): void {
  validateScenarios(scenarios);
  const outDir = requireScreenshotDir();
  mkdirSync(outDir, { recursive: true });
  // Scoped in its own describe so `test.use` below can't leak the pinned
  // locale into sibling test.describe blocks in the same spec file.
  test.describe(() => {
    // Browser-context locale for JS-side Intl/navigator.language (e.g. money-input's
    // resolvedLocale) — pinEnglishLocale() only seeds the app's own kumiko:locale.
    // ponytail: native <input type="number"> still formats per the host OS region,
    // unreachable from Playwright (context.locale and --lang both no-op there). #1851
    if (opts.pinLocale) test.use({ locale: "en-US" });
    for (const s of scenarios) {
      test(
        s.description ? `${s.name} — ${s.description}` : s.name,
        async ({ page, seedTenant }) => {
          if (opts.pinLocale) await pinEnglishLocale(page);
          const inFlightDataRequests = countInFlightDataRequests(page);
          if (s.viewport) await page.setViewportSize(s.viewport);
          await openScenario(page, s, inFlightDataRequests, { seedTenant });
          if (s.beforeCapture) await s.beforeCapture(page);
          const path = `${outDir}/${s.name}.png`;
          await page.screenshot({ path, fullPage: s.fullPage ?? false });
          expect.soft(statSync(path).size).toBeGreaterThan(MIN_BYTES);
        },
      );
    }
  });
}

const VIEWPORT_IDS = ["desktop", "tablet", "mobile"] as const;
export type ViewportId = (typeof VIEWPORT_IDS)[number];
const VIEWPORTS: Record<ViewportId, { readonly width: number; readonly height: number }> = {
  // 1920×1080 instead of the earlier 1280×900: these shots land in the
  // handbook and doc pages, where a 1280 image visibly softens on a HiDPI
  // display. Wider also shows what a two-column layout actually does — at
  // 1280 any list next to a reading pane looks cramped.
  desktop: { width: 1920, height: 1080 },
  // Landscape: portrait tablet shots collapsed two-column layouts into the mobile stack.
  tablet: { width: 1112, height: 834 },
  mobile: { width: 390, height: 844 },
};

// Narrow the axis from env (CSV) or take the default. Filters instead of
// casting: a typo in the env var (e.g. SCREENSHOT_VIEWPORTS=typo) would
// otherwise either crash at runtime (page.setViewportSize(undefined)) or,
// worse, silently produce wrong screenshots (applyTheme with an unknown
// theme value just toggles nothing).
function axis<T extends string>(env: string | undefined, all: readonly T[]): readonly T[] {
  const picked = env
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!picked || picked.length === 0) return all;
  // ponytail: filter-instead-of-cast — unknown values are silently ignored
  const known = new Set<string>(all);
  const matched = picked.filter((p): p is T => known.has(p));
  if (matched.length === 0) {
    throw new Error(
      `axis(): env filter "${env}" matched none of [${all.join(", ")}] — 0 registered tests.`,
    );
  }
  return matched;
}

export interface MatrixOptions<T extends string> {
  readonly themes: readonly T[];
  readonly applyTheme: (page: Page, theme: T) => Promise<void>;
  readonly locales?: readonly string[];
}

// App locale codes ("en"/"de") -> BCP47 tags for Playwright's browser-context
// `locale` option, pinning JS-side Intl/navigator.language regardless of the
// host's own locale — without it, a screenshot regen on a non-en-US host bakes
// in the host's Intl-driven formatting regardless of SCREENSHOT_LOCALES.
const LOCALE_TAGS: Readonly<Record<string, string>> = { en: "en-US", de: "de-DE" };

export interface ThemeScreenshotDigest<T extends string> {
  readonly viewport: string;
  readonly theme: T;
  readonly hash: string;
}

// Catches a renamed CSS class or an overridden theme provider that leaves every
// theme rendering identically — MIN_BYTES alone can't (a valid PNG is a valid
// PNG regardless of which theme produced it). Keyed by viewport so a failure
// names the exact viewport and colliding theme pair, not just the scenario.
export function findIdenticalThemeScreenshots<T extends string>(
  digests: readonly ThemeScreenshotDigest<T>[],
): string[] {
  const seenByViewport = new Map<string, Map<string, T>>();
  const violations: string[] = [];
  for (const { viewport, theme, hash } of digests) {
    let seenHashes = seenByViewport.get(viewport);
    if (seenHashes === undefined) {
      seenHashes = new Map();
      seenByViewport.set(viewport, seenHashes);
    }
    const collidingTheme = seenHashes.get(hash);
    if (collidingTheme !== undefined) {
      violations.push(
        `viewport "${viewport}": themes "${collidingTheme}" and "${theme}" produced byte-identical screenshots`,
      );
    } else {
      seenHashes.set(hash, theme);
    }
  }
  return violations;
}

export interface MatrixProjectInfo {
  readonly name: string;
  readonly isMobile: boolean;
}

export type MatrixViewportPlan =
  | { readonly mode: "device"; readonly viewports: readonly [ViewportId] }
  | { readonly mode: "desktop"; readonly viewports: readonly ViewportId[] }
  | { readonly mode: "skip"; readonly reason: string };

function isViewportId(name: string): name is ViewportId {
  return VIEWPORT_IDS.some((id) => id === name);
}

// A device project (name === a ViewportId, use.isMobile === true) already
// renders at its emulated device size, so setViewportSize would destroy that
// emulation — it captures exactly its own viewport instead of looping. Every
// other project runs the desktop pass, skipping ids a device project already
// covers so the same image isn't produced twice.
export function resolveMatrixViewports(
  projectName: string,
  isMobileProject: boolean,
  projects: readonly MatrixProjectInfo[],
  allowedViewports: readonly ViewportId[],
): MatrixViewportPlan {
  if (isMobileProject && isViewportId(projectName)) {
    if (!allowedViewports.includes(projectName)) {
      return {
        mode: "skip",
        reason: `SCREENSHOT_VIEWPORTS excludes device project "${projectName}"`,
      };
    }
    return { mode: "device", viewports: [projectName] };
  }
  const deviceProjectIds = new Set(
    projects.filter((p) => p.isMobile && isViewportId(p.name)).map((p) => p.name),
  );
  return {
    mode: "desktop",
    viewports: allowedViewports.filter((id) => !deviceProjectIds.has(id)),
  };
}

export function runMatrix<T extends string>(
  scenarios: readonly Scenario[],
  opts: MatrixOptions<T>,
): void {
  validateScenarios(scenarios);

  const baseDir = requireScreenshotDir();
  const locales = axis(process.env["SCREENSHOT_LOCALES"], opts.locales ?? ["en", "de"]);
  const themes = axis(process.env["SCREENSHOT_THEMES"], opts.themes);
  const viewports = axis(process.env["SCREENSHOT_VIEWPORTS"], VIEWPORT_IDS);
  const only = process.env["SCREENSHOT_ONLY"];

  for (const locale of locales) {
    test.describe(locale, () => {
      // Browser-context locale for JS-side Intl/navigator.language — the
      // kumiko:locale seed below only drives the app's own i18n strings.
      // ponytail: see the runScreenshots() locale comment above / #1851
      const tag = LOCALE_TAGS[locale];
      if (tag === undefined) {
        throw new Error(
          `runMatrix(): no BCP47 tag mapped for locale "${locale}" — extend LOCALE_TAGS`,
        );
      }
      test.use({ locale: tag });

      for (const s of scenarios) {
        if (only !== undefined && only !== s.name) continue;
        test(s.name, async ({ page, seedTenant }) => {
          const info = test.info();
          const plan = resolveMatrixViewports(
            info.project.name,
            info.project.use.isMobile === true,
            info.config.projects.map((p) => ({ name: p.name, isMobile: p.use.isMobile === true })),
            viewports,
          );
          if (plan.mode === "skip") {
            test.skip(true, plan.reason);
            // skip: test.skip() throws; the return only narrows `plan` for TypeScript.
            return;
          }

          // kumiko:locale drives the boot-time language (before goto); kumiko:theme
          // is cleared so the mode is decided solely by applyTheme.
          await page.addInitScript((lng) => {
            localStorage.setItem("kumiko:locale", lng);
            localStorage.removeItem("kumiko:theme");
          }, locale);
          const inFlightDataRequests = countInFlightDataRequests(page);
          await openScenario(page, s, inFlightDataRequests, { seedTenant });

          const digests: ThemeScreenshotDigest<T>[] = [];

          for (const theme of themes) {
            await opts.applyTheme(page, theme);
            for (const vp of plan.viewports) {
              if (plan.mode === "desktop") await page.setViewportSize(VIEWPORTS[vp]);
              await waitForSettledPage(page, inFlightDataRequests);
              if (s.beforeCapture) await s.beforeCapture(page);
              const dir = `${baseDir}/${s.name}/${locale}/${theme}`;
              mkdirSync(dir, { recursive: true });
              const path = `${dir}/${vp}.png`;
              // animations: "disabled" jumps to end-state at the engine level — immune to CSS specificity, unlike an addStyleTag injection.
              // screenshot() returns the same bytes it writes to `path` — reuse
              // them for both checks instead of a statSync/read-back roundtrip.
              const buffer = await page.screenshot({
                path,
                fullPage: s.fullPage ?? false,
                animations: "disabled",
              });
              expect.soft(buffer.length).toBeGreaterThan(MIN_BYTES);
              digests.push({
                viewport: vp,
                theme,
                hash: createHash("sha256").update(buffer).digest("hex"),
              });
            }
          }

          if (!s.themeInvariant) {
            expect
              .soft(
                findIdenticalThemeScreenshots(digests),
                `scenario "${s.name}" (${locale}): theme switch produced no visual difference`,
              )
              .toEqual([]);
          }
        });
      }
    });
  }
}
