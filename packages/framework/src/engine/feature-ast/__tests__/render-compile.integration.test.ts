// Real-compile half of the render roundtrip: builds the whole framework type
// program via ts-morph (several seconds, slower under coverage), so it lives
// in the integration tier instead of the 5 s unit budget.
import { beforeAll, describe, expect, test } from "bun:test";
import * as path from "node:path";
import { Project, ts } from "ts-morph";
import { renderFeatureFile } from "../render.js";
import {
  DEFINE_EVENT_WITH_MIGRATIONS_FEATURE,
  parse,
  STATIC_FEATURE,
} from "./render-roundtrip-fixtures.js";

// --- Real-compile check ---------------------------------------------------
//
// Everything above proves parse(render(patterns)) is structurally faithful.
// It does NOT prove the rendered code actually compiles against the real
// FeatureRegistrar type — parse() runs against a bare in-memory Project with
// no lib/module resolution, so a rendered call can be well-formed AST and
// still be a type error against the real registrar (e.g. a removed method).
// That gap let the r.usesApi removal (folded into r.requires({apis})) pass
// the full 4960-test suite silently; only the visual Designer would have hit
// the broken shape.
//
// This Project resolves `@cosmicdrift/kumiko-framework/*` against the real
// framework source (unlike parse()'s Project, dependency resolution is NOT
// skipped), so `r` in a compiled fixture is the real FeatureRegistrar, not a
// structural stand-in.
const FRAMEWORK_TSCONFIG_PATH = path.join(import.meta.dir, "../../../../tsconfig.json");

const compileProject = new Project({
  tsConfigFilePath: FRAMEWORK_TSCONFIG_PATH,
  skipAddingFilesFromTsConfig: true,
});

let compileCheckCounter = 0;

// The first diagnostics call builds the whole framework type program (~2.7s);
// paying it in a hook keeps it out of whichever test happens to run first.
beforeAll(() => {
  const warmup = compileProject.createSourceFile(
    path.join(import.meta.dir, "__generated__/compile-check-warmup.gen.ts"),
    'import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";\ndefineFeature("warmup", () => {});\n',
    { overwrite: true },
  );
  warmup.getPreEmitDiagnostics();
  warmup.forget();
});

function compileAgainstRegistrar(source: string): readonly string[] {
  compileCheckCounter += 1;
  const filePath = path.join(
    import.meta.dir,
    `__generated__/compile-check-${compileCheckCounter}.gen.ts`,
  );
  const sourceFile = compileProject.createSourceFile(filePath, source, { overwrite: true });
  const diagnostics = sourceFile.getPreEmitDiagnostics().map((d) => {
    const text = ts.flattenDiagnosticMessageText(d.compilerObject.messageText, "\n");
    return `${d.getLineNumber()}: ${text}`;
  });
  sourceFile.forget();
  return diagnostics;
}

function renderAndCompile(source: string): readonly string[] {
  const { featureName, patterns } = parse(source);
  const rendered = renderFeatureFile({ featureName: featureName ?? "", patterns });
  return compileAgainstRegistrar(rendered);
}

describe("render → compiles against the real FeatureRegistrar type", () => {
  test("compile check has teeth: an unknown registrar method is reported", () => {
    const diagnostics = compileAgainstRegistrar(`
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

defineFeature("teeth-check", (r) => {
  r.methodThatDoesNotExist({ nope: true });
});
`);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.join("\n")).toContain("methodThatDoesNotExist");
  });

  test("positive control: a minimal always-matched-the-real-shape fixture compiles clean", () => {
    const diagnostics = compileAgainstRegistrar(`
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

defineFeature("teeth-check-positive", (r) => {
  r.systemScope();
  r.describe("Minimal fixture proving the harness returns [] on real success.");
  r.toggleable({ default: true });
});
`);
    expect(diagnostics).toEqual([]);
  });

  test("STATIC_FEATURE's rendered header-data patterns compile clean", () => {
    expect(renderAndCompile(STATIC_FEATURE)).toEqual([]);
  });

  test("r.defineEvent's rendered migrations array compiles against the real registrar", () => {
    expect(renderAndCompile(DEFINE_EVENT_WITH_MIGRATIONS_FEATURE)).toEqual([]);
  });
});

// One self-contained, compile-clean fixture per remaining pattern kind not
// already exercised above (STATIC_FEATURE / MIXED_FEATURE / HOOK_ALL_OF /
// SCREEN_WITH_NAV / DEFINE_EVENT_WITH_MIGRATIONS). Deliberately separate
// from the parse-roundtrip fixtures above: those were written to test
// parse/render symmetry, not to be type-correct (e.g. DEFINE_EVENT_WITH_
// MIGRATIONS_FEATURE uses `z` without importing it) — reusing them here
// would produce diagnostics unrelated to the registrar shape and defeat the
// point of an exact-match assertion.
//
// RAW_REF_FEATURE and the "unknown" pattern kind are excluded on purpose:
// raw-ref sentinels reference symbols that don't exist by design, and
// "unknown" is the parser's catch-all bucket for unrecognized r.calls, not
// a real user-authored pattern.
const MANIFEST_AND_CONFIG_FEATURE = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

defineFeature("catalog", (r) => {
  r.systemScope();
  r.describe("Product catalog and pricing.");
  r.optionalRequires("promotions");
  r.uiHints({ displayLabel: "Catalog", category: "Commerce", recommended: true });
  r.readsConfig("auth.smtpHost");
  r.translations({ keys: { en: { title: "Catalog" } } });
  r.useExtension("audit-log", "item");
  r.extendsRegistrar("audit-log", {});
  r.envSchema(z.object({ CATALOG_API_KEY: z.string() }));
  r.usesApi("compliance.forTenant");
  r.exposesApi("catalog.pricingFor");
  r.secret("apiKey", {
    label: { en: "API key" },
    scope: "tenant",
    writeRoles: ["TenantAdmin"],
  });
  r.secretNamespace("webhook-auth", {
    label: { en: "Webhook auth" },
    scope: "tenant",
    writeRoles: ["TenantAdmin", "Operator"],
  });
});
`;

// r.projection is deliberately excluded here: its `table` field (a Drizzle
// table reference) is dropped by the feature-ast renderer independent of
// the object-form/positional-form issue this fixture targets — a
// pre-existing, separately tracked gap (public-api-registrar-consolidation
// plan doc, kumiko-platform). multiStreamProjection below covers the
// `apply`-map shape without hitting it (its `table` is optional).
const INTEGRATION_FEATURE = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

defineFeature("fulfillment", (r) => {
  r.job("reconcile-counts", { trigger: { manual: true } }, async (payload, context) => {
    console.log(payload, context);
  });

  r.notification("itemLowStock", {
    trigger: { on: "item:lowStock" },
    recipient: () => null,
    data: () => ({}),
  });

  r.authClaims(async () => ({}));

  r.httpRoute({
    method: "GET",
    path: "/fulfillment/feed.xml",
    handler: (c) => c.text("ok"),
  });

  r.multiStreamProjection({
    name: "item-audit",
    apply: {
      "item.created": async (event, tx, ctx) => {
        console.log(event, tx, ctx);
      },
    },
  });

  r.workspace({ id: "ops", label: "fulfillment:workspace.ops" });

  r.treeActions({ list: {} });
});
`;

describe("render → compiles against the real FeatureRegistrar type — full pattern-kind coverage", () => {
  test("manifest/config-only patterns compile clean", () => {
    expect(renderAndCompile(MANIFEST_AND_CONFIG_FEATURE)).toEqual([]);
  });

  test("job/notification/httpRoute/projection/workspace patterns compile clean", () => {
    expect(renderAndCompile(INTEGRATION_FEATURE)).toEqual([]);
  });
});
