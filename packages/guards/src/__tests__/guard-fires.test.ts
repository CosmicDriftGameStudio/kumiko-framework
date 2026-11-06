// Does every registered guard still fire?
//
// The vacuity floor and the scope check answer "did the guard even look".
// Whether its rule actually triggers isn't covered by that: a guard can scan
// 3400 files, have a broken regex, and report green.
//
// Every registered guard gets a snippet here that it must catch by
// definition. The test also fails if a guard is in neither list — a new
// registration without proof doesn't slip through.
//
// The second list is the real payoff: guards that can never produce a
// violation. They're named here explicitly instead of showing up as
// unexplained failures.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Project, type SourceFile } from "ts-morph";
import type { AstGuard, GuardOutcome } from "../_lib/guard-kit";
import { createGuard as createTailwindScanSurfaceGuard } from "../guard-tailwind-scan-surface";
import { GUARDS } from "../run-guards";
import { UI_GUARDS } from "../run-ui-guards";
import { fixtureRoot } from "./parent-workspace-fixture";

const ALL: readonly AstGuard[] = [...GUARDS, ...UI_GUARDS];

type Violating = {
  readonly path: string;
  readonly code: string;
  // Binds the fixture to the specific rule it claims to exercise — a fixture
  // that trips a DIFFERENT violation must not pass just because
  // `violations.length > 0`.
  readonly expectedMessage: RegExp;
  /**
   * Extra virtual files (e.g. a package.json a guard's gate reads) written into
   * the same in-memory project before `violating.path` is created — guards
   * whose scope check reads sibling files via `sf.getProject().getFileSystem()`
   * (i18n-Locale-Mount Guard's nearest-package.json walk) need this instead of
   * a real sibling checkout.
   */
  readonly extraFiles?: Record<string, string>;
  /**
   * Replaces `guard.run([sf])` for guards that read a baseline file or need
   * explicit roots. Fixtures get an empty tmp baseline root so a committed
   * repo baseline can't flip the verdict.
   */
  readonly execute?: (sf: SourceFile) => GuardOutcome;
};

function withTmpDir<T>(prefix: string, body: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  try {
    return body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The unconditional publishedScanSurface rule: an app whose styles.css points
// @source at `src/` of a package that only publishes `dist`.
function runTailwindPublishedSurfaceFixture(sf: SourceFile): GuardOutcome {
  return withTmpDir("fires-tailwind-app-", (appDir) =>
    withTmpDir("fires-tailwind-baseline-", (baselineRoot) => {
      mkdirSync(join(appDir, "src"), { recursive: true });
      writeFileSync(
        join(appDir, "src/styles.css"),
        '@source "../node_modules/@cosmicdriftgamestudio/kumiko-designer/src/**/*.{ts,tsx}";\n',
      );
      const pkgDir = join(appDir, "node_modules/@cosmicdriftgamestudio/kumiko-designer");
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({ name: "@cosmicdriftgamestudio/kumiko-designer", files: ["dist"] }),
      );
      const root = fixtureRoot("app-fixture", appDir, {
        kind: "app",
        sourceRoots: ["src"],
        testGlobs: ["src/**/*.test.ts"],
      });
      return createTailwindScanSurfaceGuard({ baselineRoot }).run([sf], [root]);
    }),
  );
}

// Paths need the "packages/"/"samples/" marker: relFromRepoRoot() classifies
// in-memory paths above it because they don't sit under any real repo root.
// Anchored under process.cwd() because guard-cross-feature-imports
// etc. relativize their paths against
// `ROOT = process.cwd()`, and a path outside that becomes "../../..", which
// hits no regex.
const CWD = process.cwd();
const PKG = `${CWD}/packages/framework/src`;
const FEAT = `${CWD}/packages/bundled-features/src`;
const APP = `${CWD}/packages/app/src`;

const ENFORCING: Record<string, Violating> = {
  "Direct-Entity-Writes Guard": {
    path: `${PKG}/features/x/handler.ts`,
    code: "declare const xTable: unknown;\ndeclare function createEventStoreExecutor(table: unknown, entity: unknown): unknown;\ndeclare const someEntityDef: unknown;\nexport const executor = createEventStoreExecutor(xTable, someEntityDef);\n\nexport function directWrite(db: any) {\n\tdb.insert(xTable);\n}\n",
    expectedMessage: /\[non-tx-receiver\] db\.insert\(xTable\)/,
  },
  "Import-Extensions Guard": {
    path: `${PKG}/features/x/imports.ts`,
    code: 'import { helper } from "./helper.js";\nexport const run = helper;',
    expectedMessage: /relative import "\.\/helper\.js"/,
    extraFiles: { [`${PKG}/features/x/helper.ts`]: "export const helper = 1;" },
  },
  "HTML-Escape Guard": {
    path: `${PKG}/mail/tpl.ts`,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${} is the parsed source text, not a template mistake
    code: "export const t = (name: string) => `<p>${name}</p>`;",
    expectedMessage: /unescaped interpolation in HTML template/,
  },
  "Cross-Feature-Import Guard": {
    path: `${FEAT}/alpha/view.ts`,
    code: 'import { thing } from "../beta/internal";\nexport const v = thing;',
    expectedMessage: /feature "alpha" → "beta"/,
  },
  "i18n-Keys Guard": {
    path: `${PKG}/features/x/web/screen.tsx`,
    code: 'export const S = () => t("x:missing.key.that.does.not.exist");',
    expectedMessage: /"x:missing\.key\.that\.does\.not\.exist"/,
  },
  "i18n-Locale-Mount Guard": {
    path: `${APP}/web/mount.tsx`,
    code: "createKumikoApp({ shell: X, clientFeatures: [] });",
    expectedMessage: /localeDeClient\(\) missing/,
    extraFiles: {
      [`${CWD}/packages/app/package.json`]: JSON.stringify({
        name: "fixture-app",
        dependencies: { "@cosmicdrift/kumiko-locale-de": "0.1.0" },
      }),
    },
  },
  "Internal-Subpath-Imports Guard": {
    path: `${PKG}/features/x/scope.ts`,
    code: 'import { runInSystemRowLevelSecurityScope } from "k";\nexport const run = (why: string) => runInSystemRowLevelSecurityScope(why, async () => 1);',
    expectedMessage:
      /\[system-scope-reason\] runInSystemRowLevelSecurityScope needs a non-empty string literal reason/,
  },
  "RLS-Session-Settings Guard": {
    path: `${PKG}/features/x/scope.ts`,
    code: `export const q = "${["SET", "SESSION", "kumiko.tenant_id", "=", "'t'"].join(" ")}";`,
    expectedMessage: /\[rls-session-setting\] SET \/ SET SESSION/,
  },
  "Fake-Test Guard": {
    path: `${PKG}/features/x/thing.test.ts`,
    code: 'import { expect, test } from "bun:test";\ntest("it works", () => {\n\texpect(true).toBe(true);\n});',
    expectedMessage: /TAUTOLOGY: expect\(true\)\.toBe\(true\)/,
  },
  "Tenant-Escalation Guard": {
    path: `${PKG}/features/x/write-handler.ts`,
    code: 'declare function defineWriteHandler(cfg: unknown): unknown;\ndeclare const z: any;\nexport const h = defineWriteHandler({ name: "grantRole", schema: z.object({ role: z.string() }), access: { roles: ["TenantAdmin"] }, handler: async () => ({ isSuccess: true, data: {} }) });',
    expectedMessage: /has no escalation test/,
  },
  "No-Logic-in-Views Guard (App-Repos)": {
    path: `${APP}/features/x/web/calc.tsx`,
    code: "export function paidFraction(principal: number, remaining: number): number {\n  if (principal <= 0) return 0;\n  return Math.max(0, Math.min(1, (principal - remaining) / principal));\n}",
    expectedMessage: /View logic "paidFraction" belongs in lib\//,
  },
  "App-Feature-Structure Guard (App-Repos)": {
    path: `${FEAT}/x/web.tsx`,
    code: "export const screens = {};",
    expectedMessage: /web monolith at feature root/,
  },
  "Lib-Test-Coverage Guard (App-Repos)": {
    path: `${APP}/features/x/lib/calc.ts`,
    code: "export function addFees(base: number): number { return base * 1.02; }",
    expectedMessage: /No test imports this lib module/,
  },
  "No-Framed-Extension-Sections Guard": {
    path: `${FEAT}/x/web/client-plugin.tsx`,
    code: 'function NotesSection() { return <Card slots={{ title: "Notes" }}>x</Card>; }\nexport function demoClient() {\n\treturn { extensionSectionComponents: { notes: NotesSection } };\n}',
    expectedMessage: /Extension-section component "NotesSection" renders its own <Card>/,
  },
  "Screen-Conventions Guard": {
    path: `${PKG}/features/x/screens.ts`,
    code: 'declare const r: { screen: (x: unknown) => unknown };\nr.screen({ layout: { sections: [{ kind: "relatedList" }] } });',
    expectedMessage: /relatedList section without `rowClick`\/`rowActions`/,
  },
  "i18n-UI-Strings Guard (App-Repos)": {
    path: `${APP}/features/x/web/screen.tsx`,
    code: "export const S = () => <div>Lade Tenants…</div>;",
    expectedMessage: /hardcoded JSX text/,
  },
  "Write-Handler-QN Guard": {
    path: `${PKG}/features/x/web/screen.tsx`,
    code: 'declare const dispatcher: { write: (qn: string, payload?: unknown) => unknown };\nexport const run = () => dispatcher.write("bad-qn-format");',
    expectedMessage: /invalid QN format/,
  },
  "Tailwind-Scan-Surface Guard": {
    path: `${PKG}/features/x/noop.ts`,
    code: "export const noop = 1;",
    expectedMessage: /only publishes \[dist\]/,
    execute: runTailwindPublishedSurfaceFixture,
  },
  "As-Casts Audit": {
    path: `${PKG}/features/x/cast.ts`,
    code: "declare const x: unknown;\nexport const y = x as string;",
    expectedMessage: /Suspect cast regression/,
  },
  "test-timeouts": {
    path: `${PKG}/features/x/__tests__/x.test.ts`,
    code: "declare function sleep(ms: number): Promise<void>;\ndeclare function ready(): boolean;\nexport async function poll() { while (!ready()) { await sleep(10); } }",
    expectedMessage: /while loop polls with sleep/,
  },
  "Test-ES-Row-Writes Guard": {
    path: `${PKG}/features/x/__tests__/x.integration.test.ts`,
    code: 'import { updateRows } from "@cosmicdrift/kumiko-testing/helpers";\ndeclare const db: never;\nexport const run = () => updateRows(db, {} as never, {}, {});',
    expectedMessage: /updateRows\/deleteRows bypass the event store/,
  },
  "File Size": {
    path: `${PKG}/features/x/huge.ts`,
    code: "export const line = 1;\n".repeat(2001),
    expectedMessage: /oversized file\(s\)/,
  },
  "test-template-drift": {
    path: `${PKG}/features/x/e2e/screen.spec.ts`,
    code: 'declare const page: { screenshot: (opts: unknown) => Promise<void> };\nexport const run = () => page.screenshot({ path: "out.png" });',
    expectedMessage: /Direct page\.screenshot/,
  },
  "comment-issue-ref-only": {
    path: `${PKG}/features/x/refs.ts`,
    code: "// see #1234\nexport const value = 1;\n",
    expectedMessage: /issue-reference-only comment\(s\) over baseline/,
  },
  "ignore-tag-reason": {
    path: `${PKG}/features/x/ignore.ts`,
    code: "// kumiko-lint-ignore raw-sql legacy\nexport const value = 1;\n",
    expectedMessage: /ignore tag\(s\) without a real reason over baseline/,
  },
  "security-plugin-suppression": {
    path: `${PKG}/features/x/fetcher.ts`,
    code: "// biome-ignore lint/plugin: user supplied url here\nexport const load = (url: string) => fetch(url);\n",
    expectedMessage: /suppressed security plugin finding\(s\)/,
  },
};

// These guards can't produce a violation by construction — they report
// their findings via console and always return `violations: []`. The entry
// here is bookkeeping about what does NOT block, not a free pass.
const WARNING_ONLY: Record<string, string> = {
  "Complexity Check":
    "baseline-ratchet pattern — only fails against a committed `.kumiko-complexity-baseline.json`; stays warning-only until a repo bootstraps it with --write-baseline",
};

describe("every registered guard catches its own violation", () => {
  test("every guard is either enforcing or booked as warning-only", () => {
    const unaccounted = ALL.map((g) => g.name).filter(
      (n) => !Object.hasOwn(ENFORCING, n) && !Object.hasOwn(WARNING_ONLY, n),
    );
    expect(unaccounted).toEqual([]);
    const names = new Set(ALL.map((g) => g.name));
    expect(
      [...Object.keys(ENFORCING), ...Object.keys(WARNING_ONLY)].filter((n) => !names.has(n)),
    ).toEqual([]);
  });

  test("no guard is in both lists", () => {
    const both = Object.keys(ENFORCING).filter((n) => Object.hasOwn(WARNING_ONLY, n));
    expect(both).toEqual([]);
  });

  for (const guard of ALL) {
    const violating = Object.hasOwn(ENFORCING, guard.name) ? ENFORCING[guard.name] : undefined;
    if (violating === undefined) continue;
    test(guard.name, () => {
      const project = new Project({ useInMemoryFileSystem: true });
      for (const [path, content] of Object.entries(violating.extraFiles ?? {})) {
        project.getFileSystem().writeFileSync(path, content);
      }
      const sf = project.createSourceFile(violating.path, violating.code);
      const outcome = violating.execute ? violating.execute(sf) : guard.run([sf]);
      expect(outcome.violations.some((v) => violating.expectedMessage.test(v.message))).toBe(true);
    });
  }

  test("Cross-Feature-Import Guard covers .tsx screens but not .test.tsx files", () => {
    const guard = ALL.find((g) => g.name === "Cross-Feature-Import Guard");
    expect(guard?.scan.extensions).toContain("tsx");
    const project = new Project({ useInMemoryFileSystem: true });
    const code = 'import { thing } from "../../beta/internal";\nexport const v = thing;';
    const screen = project.createSourceFile(`${FEAT}/alpha/web/screen.tsx`, code);
    const screenTest = project.createSourceFile(`${FEAT}/alpha/web/screen.test.tsx`, code);
    expect(guard?.run([screen]).violations.map((v) => v.message)).toEqual([
      'feature "alpha" → "beta" (../../beta/internal)',
    ]);
    expect(guard?.run([screenTest]).violations).toEqual([]);
  });

  test("Cross-Feature-Import Guard lets a screen import another feature's web barrel", () => {
    const guard = ALL.find((g) => g.name === "Cross-Feature-Import Guard");
    const project = new Project({ useInMemoryFileSystem: true });
    const screen = project.createSourceFile(
      `${FEAT}/alpha/web/screen.tsx`,
      'import { a } from "../../beta/web";\nimport { b } from "../../beta/web/index.ts";\nexport const v = [a, b];',
    );
    expect(guard?.run([screen]).violations).toEqual([]);
  });
});
