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
import { Project } from "ts-morph";
import type { AstGuard } from "../_lib/guard-kit";
import { GUARDS } from "../run-guards";
import { UI_GUARDS } from "../run-ui-guards";

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
};

// Paths need the "packages/"/"samples/" marker: relFromRepoRoot() classifies
// in-memory paths above it because they don't sit under any real repo root.
// Anchored under process.cwd() because guard-cross-feature-imports,
// guard-pre-es-patterns, etc. relativize their paths against
// `ROOT = process.cwd()`, and a path outside that becomes "../../..", which
// hits no regex.
const CWD = process.cwd();
const PKG = `${CWD}/packages/framework/src`;
const FEAT = `${CWD}/packages/bundled-features/src`;
const APP = `${CWD}/packages/app/src`;

const ENFORCING: Record<string, Violating> = {
  "Raw section.fields Guard": {
    path: `${PKG}/engine/reader.ts`,
    code: "declare const section: { fields: { field: string }[] };\nfor (const rawField of section.fields) { void rawField; }",
    expectedMessage: /raw section\.fields read\(s\) over baseline/,
  },
  "Pre-ES-Patterns Guard": {
    path: `${PKG}/features/x/log.ts`,
    code: 'import { createEventLog } from "k";\nexport const l = createEventLog("x");',
    expectedMessage: /\[createEventLog\]/,
  },
  "Direct-Entity-Writes Guard": {
    path: `${PKG}/features/x/handler.ts`,
    code: "declare const xTable: unknown;\ndeclare function createEventStoreExecutor(table: unknown, entity: unknown): unknown;\ndeclare const someEntityDef: unknown;\nexport const executor = createEventStoreExecutor(xTable, someEntityDef);\n\nexport function directWrite(db: any) {\n\tdb.insert(xTable);\n}\n",
    expectedMessage: /\[non-tx-receiver\] db\.insert\(xTable\)/,
  },
  "Direct-Fetch Guard": {
    path: `${PKG}/features/x/outbound.ts`,
    code: 'export const load = () => fetch("https://example.com");',
    expectedMessage: /raw fetch\(\) call/,
  },
  "Unsafe-JSON-Parse Guard": {
    path: `${PKG}/x/parse.ts`,
    code: "export function p(s: string) { return JSON.parse(s); }",
    expectedMessage: /unguarded JSON\.parse/,
  },
  "Silent-Skip Guard": {
    path: `${PKG}/features/x/hooks.ts`,
    code: 'export function onEvent(e: { ok: boolean }) {\n\tif (!e.ok) {\n\t\treturn;\n\t}\n\tconsole.log("done");\n}',
    expectedMessage: /\[function\] in onEvent/,
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
  "No-Date-API Guard": {
    path: `${PKG}/features/x/time.ts`,
    code: "export const now = () => new Date().getTime();",
    expectedMessage: /\[new Date\]|\[\.getTime\]/,
  },
  "No-Direct-Fs Guard": {
    path: `${PKG}/features/x/io.ts`,
    code: 'import { readFileSync } from "node:fs";\nexport const r = () => readFileSync("/tmp/x");',
    expectedMessage: /\[node:fs\] direct fs import outside allowlist/,
  },
  "No-Broker-Subscribe Guard": {
    path: `${PKG}/features/x/sub.ts`,
    code: 'import { broker } from "k";\nexport const s = () => broker.subscribe("topic", () => {});',
    expectedMessage: /\[broker\.subscribe\]/,
  },
  "Error-Reasons Guard": {
    path: `${PKG}/features/x/err.ts`,
    code: 'export const fail = () => ({ reason: "something went wrong" });',
    expectedMessage: /details\.reason "something went wrong"/,
  },
  "i18n-Keys Guard": {
    path: `${PKG}/features/x/web/screen.tsx`,
    code: 'export const S = () => t("x:missing.key.that.does.not.exist");',
    expectedMessage: /"x:missing\.key\.that\.does\.not\.exist"/,
  },
  "i18n-Locale-Terminology Guard": {
    path: `${CWD}/packages/locale-de/src/strings.ts`,
    code: 'export const localeDeBundle = { "x.y": "Bitte Tenant wählen" };',
    expectedMessage: /verbotener Begriff "Tenant"/,
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
  "Restricted-Symbols Guard": {
    path: `${PKG}/features/x/read.ts`,
    code: 'import { getUnscopedAggregateStreamMaxVersion } from "k";\nexport const v = () => getUnscopedAggregateStreamMaxVersion("a");',
    expectedMessage: /\[getUnscopedAggregateStreamMaxVersion\]/,
  },
  "Admin-API Guard": {
    path: `${PKG}/features/x/admin.ts`,
    code: 'import { appendRaw } from "k";\nexport async function run(ctx: any) { await appendRaw(ctx, { type: "x" }); }',
    expectedMessage: /appendRaw\(\.\.\.\) in run/,
  },
  "Fake-Test Guard": {
    path: `${PKG}/features/x/thing.test.ts`,
    code: 'import { expect, test } from "bun:test";\ntest("it works", () => {\n\texpect(true).toBe(true);\n});',
    expectedMessage: /TAUTOLOGY: expect\(true\)\.toBe\(true\)/,
  },
  "Tenant-Escalation Guard": {
    path: `${PKG}/features/x/write-handler.ts`,
    code: 'import { defineWriteHandler } from "k";\nimport { z } from "zod";\nexport const h = defineWriteHandler({ access: { tenantAdmin: true }, payload: { tenantIdOverride: z.string() }, async run(ctx: any, p: { tenantIdOverride: string }) { await ctx.db.raw("SELECT 1", [p.tenantIdOverride]); } });',
    expectedMessage: /exposes tenantIdOverride but never calls crossTenantOverrideDenied/,
  },
  "Escape-Hatch-Declared Guard": {
    path: `${FEAT}/x/handlers/ack.write.ts`,
    code: 'export async function h(ctx: any) { return ctx.systemDb.acknowledgeCrossTenant("todo"); }',
    expectedMessage: /uses a placeholder reason/,
  },
  "Access-Denied-Test Guard": {
    path: `${FEAT}/x/handlers/approve.write.ts`,
    code: 'declare function defineWriteHandler(cfg: unknown): unknown;\nconst h = defineWriteHandler({ name: "approve-invoice", access: { roles: ["TenantAdmin"] }, handler: async () => ({}) });',
    expectedMessage: /has no access-denied test/,
  },
  "Open-To-All-Reason Guard": {
    path: `${FEAT}/x/handlers/ack.write.ts`,
    code: 'export const a = { access: { openToAll: { reason: "todo" } } };',
    expectedMessage: /uses a placeholder reason/,
  },
  "No-Logic-in-Views Guard (App-Repos)": {
    path: `${APP}/features/x/web/calc.tsx`,
    code: "export function paidFraction(principal: number, remaining: number): number {\n  if (principal <= 0) return 0;\n  return Math.max(0, Math.min(1, (principal - remaining) / principal));\n}",
    expectedMessage: /View logic "paidFraction" belongs in lib\//,
  },
  "App-Feature-Structure Guard (App-Repos)": {
    path: `${FEAT}/x/web.tsx`,
    code: "export const screens = {};",
    expectedMessage: /web-Monolith am Feature-Root/,
  },
  "Lib-Test-Coverage Guard (App-Repos)": {
    path: `${APP}/features/x/lib/calc.ts`,
    code: "export function addFees(base: number): number { return base * 1.02; }",
    expectedMessage: /Kein Test importiert dieses lib-Modul/,
  },
  "Raw-ClassName Guard (App-Repos)": {
    path: `${APP}/features/x/web/card.tsx`,
    code: 'export const C = () => <div className="bg-red-500">x</div>;',
    expectedMessage: /design-bearing Tailwind classes/,
  },
  "No-Inline-Styles Guard (App-Repos)": {
    path: `${APP}/features/x/web/box.tsx`,
    code: "export const B = () => <div style={{ padding: 8 }}>x</div>;",
    expectedMessage: /style= prop in app code/,
  },
  "No-Custom-Primitives Guard (App-Repos)": {
    path: `${APP}/features/x/web/table.tsx`,
    code: "const StatCard = () => <div>x</div>;\nexport const T = () => <StatCard />;",
    expectedMessage: /App-local UI primitive "StatCard"/,
  },
  "No-Framed-Extension-Sections Guard": {
    path: `${FEAT}/x/web/client-plugin.tsx`,
    code: 'function NotesSection() { return <Card slots={{ title: "Notes" }}>x</Card>; }\nexport function demoClient() {\n\treturn { extensionSectionComponents: { notes: NotesSection } };\n}',
    expectedMessage: /Extension-section component "NotesSection" renders its own <Card>/,
  },
  "No-Raw-Hooks Guard (App-Repos)": {
    path: `${APP}/features/x/web/screen.tsx`,
    code: 'import { useEffect } from "react";\nexport const S = () => { useEffect(() => {}, []); return null; };',
    expectedMessage: /useEffect in App-Screen/,
  },
  "Screen-Conventions Guard": {
    path: `${PKG}/features/x/screens.ts`,
    code: 'declare const r: { screen: (x: unknown) => unknown };\nr.screen({ metrics: ["42"] });',
    expectedMessage: /metrics entry "42" is a plain string/,
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
  "loadAllEventsByType Guard": {
    path: `${PKG}/features/x/events.ts`,
    code: 'declare function loadAllEventsByType(t: string): unknown;\nexport const load = () => loadAllEventsByType("x");',
    expectedMessage: /loadAllEventsByType\(\.\.\.\) in load/,
  },
};

// These guards can't produce a violation by construction — they report
// their findings via console and always return `violations: []`. The entry
// here is bookkeeping about what does NOT block, not a free pass.
const WARNING_ONLY: Record<string, string> = {
  "Tailwind-Scan-Surface Guard":
    "baseline-ratchet pattern (infra#654) — only fails against a committed baseline file; stays warning-only until a repo bootstraps it with --write-baseline",
  "Raw-Interactive-Elements Guard (App-Repos)":
    "same baseline-ratchet pattern as Tailwind-Scan-Surface Guard — only fails against a committed baseline file; stays warning-only until an app repo bootstraps it with --write-baseline",
  "PII-Annotations Guard":
    "same baseline-ratchet pattern as Tailwind-Scan-Surface Guard (infra#412) — only fails against a committed baseline file; stays warning-only until a consumer repo bootstraps it with --write-baseline",
  "Text-Field Personal-Stance Guard":
    "same baseline-ratchet pattern as PII-Annotations Guard (kumiko-framework#2810) — only fails against a committed baseline file; stays warning-only until a consumer repo bootstraps it with --write-baseline",
  "Complexity Check":
    "same baseline-ratchet pattern as Tailwind-Scan-Surface Guard — only fails against a committed `.kumiko-complexity-baseline.json`; stays warning-only until a repo bootstraps it with --write-baseline",
  "test-timeouts":
    "same baseline-ratchet pattern as Complexity Check — only fails against a committed `.kumiko-test-timeouts-baseline.json`; stays warning-only until a repo bootstraps it with --write-baseline. Detection itself is proven in guard-test-timeouts.test.ts",
  "Predicate Extraction Check":
    "coding-standards.md 'Predicate Extraction' — Automatischer Check ist explizit 'Warnung, kein Fail'; reports Fat-Predicate/Duplicate candidates via console, always returns violations: []",
  "As-Casts Audit":
    "coding-standards.md 'Type Assertions' — Automatischer Check ist explizit 'Warnung, kein Fail'; reports suspect casts + baseline delta via console, always returns violations: []",
  "Table-DDL Guard":
    "documented warning-only in its own module header (unsafe* bypass calls outside the allowlist are reported via console, never blocking)",
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
      const outcome = guard.run([sf]);
      expect(outcome.violations.some((v) => violating.expectedMessage.test(v.message))).toBe(true);
    });
  }

  // A fixture per WARNING_ONLY guard that would be a finding under the
  // underlying rule — proves `violations: []` holds even when the guard has
  // something to report (console-only), not just on a clean tree where "no
  // violations" would be true either way.
  const WARNING_ONLY_FIXTURES: Record<string, Violating> = {
    "Raw-Interactive-Elements Guard (App-Repos)": {
      path: `${APP}/features/x/web/link.tsx`,
      code: 'import { StatusBadge } from "@cosmicdrift/kumiko-renderer-web";\nexport const X = () => <a href="/x">go</a>;',
      expectedMessage: /.*/,
    },
    "As-Casts Audit": {
      path: `${PKG}/features/x/cast.ts`,
      code: "export const f = (x: unknown) => x as string;",
      expectedMessage: /.*/,
    },
    "Table-DDL Guard": {
      path: `${PKG}/features/x/tables.ts`,
      code: "declare function unsafePushTables(): void;\nexport const run = () => unsafePushTables();",
      expectedMessage: /.*/,
    },
  };

  for (const guard of ALL) {
    const fixture = Object.hasOwn(WARNING_ONLY_FIXTURES, guard.name)
      ? WARNING_ONLY_FIXTURES[guard.name]
      : undefined;
    if (fixture === undefined) continue;
    test(`${guard.name} (warning-only: never blocks even on a real finding)`, () => {
      const project = new Project({ useInMemoryFileSystem: true });
      const sf = project.createSourceFile(fixture.path, fixture.code);
      const outcome = guard.run([sf]);
      expect(outcome.violations).toEqual([]);
    });
  }
});
