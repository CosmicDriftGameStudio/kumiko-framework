// Regression-Guard für die EIGENTLICHE Behauptung der Codegen-Pipeline:
// `ctx.appendEvent` wird via Lokal-Wrapper STRICT typgeprüft.
//
// Ohne diesen Test verifizieren die anderen 12 Codegen-Tests nur, dass
// die richtigen Strings ins File geschrieben werden. Wenn jemand später
// das `export *`-Shadowing kaputt macht, den `KumikoEventTypeMap`-
// Re-Export aus `engine/index.ts` entfernt, oder TS-Verhalten in einer
// neuen Version subtil bricht — die anderen Tests bleiben grün und der
// strict-mode stirbt schweigend. Genau das wäre der Fall den dieser
// Test fängt.
//
// Ablauf pro Test-Case:
//   1. tmp-App mit feature.ts + events.ts + bin/main.ts erzeugen.
//   2. `runCodegen` auf die tmp-App fahren — schreibt
//      `.kumiko/types.generated.d.ts` + `define.ts`.
//   3. Eine synthetische Test-Datei mit den gewünschten Aufrufen schreiben.
//   4. ts.createProgram über die App + paths-alias zur framework-source.
//   5. Diagnostics auswerten — auf konkrete TS-Codes prüfen.
//
// `paths` zeigt direkt auf die framework-source (`packages/framework/src`),
// damit der TS-Type-Checker die Augmentation als Teil DESSELBEN Compiles
// sieht (Use-Site-Substitution funktioniert nur so — siehe
// project_x1_typemap_findings memory).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as ts from "typescript";
import { afterAll, describe, expect, test } from "vitest";
import { runCodegen } from "../run-codegen";

const REPO_ROOT = join(__dirname, "../../../../..");
const FRAMEWORK_SRC = join(REPO_ROOT, "packages/framework/src");

// Test-Apps werden IM Repo-Tree angelegt (gitignored), damit Node's
// natürliches `node_modules`-Hochsuchen 'zod' & Co finden kann. tmpdir
// liegt außerhalb des Repo-Trees → keine node_modules-Sicht.
const TEST_FIXTURE_DIR = join(__dirname, ".tmp-fixtures");
const createdDirs: string[] = [];

function makeAppDir(): string {
  mkdirSync(TEST_FIXTURE_DIR, { recursive: true });
  const dir = mkdtempSync(join(TEST_FIXTURE_DIR, "app-"));
  createdDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const d of createdDirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
  try {
    rmSync(TEST_FIXTURE_DIR, { recursive: true, force: true });
  } catch {
    // ditto
  }
});

function write(dir: string, relPath: string, content: string): string {
  const full = join(dir, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, "utf-8");
  return full;
}

/**
 * Baut ein TS-Program über die App + framework-source, gibt die
 * semantischen Diagnostics zurück. Lib-files werden vom installierten
 * typescript-Package geholt; sonst meckert TS über fehlende DOM-types.
 */
function compileApp(appRoot: string): readonly ts.Diagnostic[] {
  // Wir lassen ts node_modules vom REPO_ROOT auflösen (tmp-Dir hat kein
  // eigenes node_modules). `baseUrl` zeigt auf repo, `paths` mappt
  // framework + tmp-app explizit; rest fällt auf node_modules-Lookup
  // im repo-Tree zurück.
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    esModuleInterop: true,
    noEmit: true,
    baseUrl: REPO_ROOT,
    paths: {
      "@kumiko/framework/*": [join(FRAMEWORK_SRC, "*/index.ts")],
    },
    types: [],
  };

  // Sammle alle .ts-Files unter src/ + .kumiko/, plus die framework-
  // source-tree die wir via paths erreichen wollen.
  const program = ts.createProgram({
    rootNames: collectFiles(appRoot),
    options: compilerOptions,
  });
  return ts.getPreEmitDiagnostics(program);
}

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  const fs = require("node:fs");
  const walk = (d: string) => {
    let entries: string[];
    try {
      entries = fs.readdirSync(d);
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.startsWith(".") && e !== ".kumiko") continue;
      if (e === "node_modules") continue;
      const full = join(d, e);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) walk(full);
      else if (stat.isFile() && (e.endsWith(".ts") || e.endsWith(".tsx")) && !e.endsWith(".d.ts"))
        out.push(full);
    }
  };
  walk(join(dir, "src"));
  walk(join(dir, ".kumiko"));
  return out;
}

// Default-shape feature: setup callback registers `placed` and returns
// nothing. Used by tests that exercise the standard `ctx.appendEvent({
// type: "orders:event:placed", ... })` literal-string path.
function setupApp(): string {
  const appRoot = makeAppDir();
  writeOrderPlacedSchema(appRoot);
  write(
    appRoot,
    "src/feature/feature.ts",
    `import { defineFeature } from "@kumiko/framework/engine";
import { orderPlacedSchema } from "./events";

export const ordersFeature = defineFeature("orders", (r) => {
  r.defineEvent("placed", orderPlacedSchema);
});
`,
  );
  return appRoot;
}

// Exports-shape feature: setup callback returns `{ placed }` so handler
// modules can do `ordersFeature.exports.placed.name` and pick up the
// literal type. Used by the eventDef.name pattern test.
function setupAppWithExports(): string {
  const appRoot = makeAppDir();
  writeOrderPlacedSchema(appRoot);
  write(
    appRoot,
    "src/feature/feature.ts",
    `import { defineFeature } from "@kumiko/framework/engine";
import { orderPlacedSchema } from "./events";

export const ordersFeature = defineFeature("orders", (r) => ({
  placed: r.defineEvent("placed", orderPlacedSchema),
}));
`,
  );
  return appRoot;
}

function writeOrderPlacedSchema(appRoot: string): void {
  write(
    appRoot,
    "src/feature/events.ts",
    `import { z } from "zod";
export const orderPlacedSchema = z.object({
  orderId: z.string(),
  customerId: z.string(),
  amount: z.number(),
});
`,
  );
}

describe("strict-mode diagnostics — the actual contract of the codegen", () => {
  test("good ctx.appendEvent compiles cleanly", () => {
    const appRoot = setupApp();
    runCodegen({ appRoot });

    write(
      appRoot,
      "src/feature/handler.ts",
      `import { defineWriteHandler } from "../../.kumiko/define";
import { z } from "zod";

export const placeOrder = defineWriteHandler({
  name: "orders.placeOrder",
  schema: z.object({}),
  access: { roles: ["Admin"] },
  handler: async (_event, ctx) => {
    await ctx.appendEvent({
      aggregateId: "x",
      aggregateType: "order",
      type: "orders:event:placed",
      payload: { orderId: "o1", customerId: "c1", amount: 99 },
    });
    return { isSuccess: true as const, data: { id: "o1" } };
  },
});
`,
    );

    const diagnostics = compileApp(appRoot);
    const handlerErrors = diagnostics.filter((d) =>
      d.file?.fileName.endsWith("/feature/handler.ts"),
    );
    expect(handlerErrors).toHaveLength(0);
  });

  test("unknown event-type triggers TS2322 with augmented map in error message", () => {
    const appRoot = setupApp();
    runCodegen({ appRoot });

    write(
      appRoot,
      "src/feature/handler.ts",
      `import { defineWriteHandler } from "../../.kumiko/define";
import { z } from "zod";

export const placeOrder = defineWriteHandler({
  name: "orders.placeOrder",
  schema: z.object({}),
  access: { roles: ["Admin"] },
  handler: async (_event, ctx) => {
    await ctx.appendEvent({
      aggregateId: "x",
      aggregateType: "order",
      type: "totally:made:up",
      payload: { whatever: 1 },
    });
    return { isSuccess: true as const, data: { id: "x" } };
  },
});
`,
    );

    const diagnostics = compileApp(appRoot);
    const handlerErrors = diagnostics.filter((d) =>
      d.file?.fileName.endsWith("/feature/handler.ts"),
    );
    // We expect at least one TS2322 ("not assignable") for the bogus
    // type-string. The exact column may move with TS versions; the code
    // + the type-name are the stable contract.
    const ts2322 = handlerErrors.filter((d) => d.code === 2322);
    expect(ts2322.length).toBeGreaterThan(0);
    const flattened = ts2322
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))
      .join("\n");
    expect(flattened).toMatch(/keyof KumikoEventTypeMap|"orders:event:placed"/);
  });

  test("payload-shape mismatch triggers a property-error", () => {
    const appRoot = setupApp();
    runCodegen({ appRoot });

    write(
      appRoot,
      "src/feature/handler.ts",
      `import { defineWriteHandler } from "../../.kumiko/define";
import { z } from "zod";

export const placeOrder = defineWriteHandler({
  name: "orders.placeOrder",
  schema: z.object({}),
  access: { roles: ["Admin"] },
  handler: async (_event, ctx) => {
    await ctx.appendEvent({
      aggregateId: "x",
      aggregateType: "order",
      type: "orders:event:placed",
      payload: { orderId: "o1", customerId: "c1", amount: 99, bogus: "extra" },
    });
    return { isSuccess: true as const, data: { id: "o1" } };
  },
});
`,
    );

    const diagnostics = compileApp(appRoot);
    const handlerErrors = diagnostics.filter((d) =>
      d.file?.fileName.endsWith("/feature/handler.ts"),
    );
    // TS2353 = "Object literal may only specify known properties, and
    // 'bogus' does not exist in type". This is the property-level
    // strict-check we promised.
    const propErrors = handlerErrors.filter((d) => d.code === 2353);
    expect(propErrors.length).toBeGreaterThan(0);
    const flattened = propErrors
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))
      .join("\n");
    expect(flattened).toMatch(/'bogus'/);
  });

  test("direct framework-import + augmentation-included compiles strict too", () => {
    // Sanity-Check: in einem isolated app-tsc (tmp-fixture mit paths-
    // mapping zur framework-source UND .kumiko/types.generated.d.ts im
    // include-Glob) greift strict-mode auch beim direct framework-import.
    // Generic-function-inference nimmt die augmentation am use-site wahr.
    //
    // Konsequenz: der Wrapper ist NICHT der einzige Weg zu strict —
    // aber er ist DER ROBUSTE Weg. Er importiert `types.generated`
    // explicit als side-effect, sodass die Augmentation auch in
    // partial-builds / IDE-Sprachserver-stati garantiert visible ist.
    // Direkter Import setzt voraus, dass das tsconfig-Setup stimmt.
    //
    // Die alte "K=never"-Beobachtung aus den 13 Probes war im
    // bundled-features-Compile, wo das `.kumiko/`-Output nicht im
    // include-Glob lag — die Augmentation aus inline `declare module`
    // hatte einen anderen Resolution-Pfad. Der Wrapper bleibt der
    // empfohlene Pfad für Apps, weil er diese Setup-Sensibilität wegabstrahiert.
    const appRoot = setupApp();
    runCodegen({ appRoot });

    write(
      appRoot,
      "src/feature/handler-direct.ts",
      `import { defineWriteHandler } from "@kumiko/framework/engine";
import { z } from "zod";

export const placeOrder = defineWriteHandler({
  name: "orders.placeOrder",
  schema: z.object({}),
  access: { roles: ["Admin"] },
  handler: async (_event, ctx) => {
    await ctx.appendEvent({
      aggregateId: "x",
      aggregateType: "order",
      type: "orders:event:placed",
      payload: { orderId: "o1", customerId: "c1", amount: 99 },
    });
    return { isSuccess: true as const, data: { id: "o1" } };
  },
});
`,
    );

    const diagnostics = compileApp(appRoot);
    const handlerErrors = diagnostics.filter((d) =>
      d.file?.fileName.endsWith("/feature/handler-direct.ts"),
    );
    // Good call should compile — augmentation is visible via include of
    // `.kumiko/types.generated.d.ts`.
    expect(handlerErrors).toHaveLength(0);
  });

  test("eventDef.name pattern: literal-typed name resolves to correct payload-shape", () => {
    // Marten pattern: `const placed = r.defineEvent(...)`, then
    // `type: placed.name` in appendEvent. This requires `EventDef.name`
    // to be LITERAL-typed (`"orders:event:placed"`, NOT `string`) —
    // otherwise the lookup collapses to `string` and the strict check
    // silently disappears.
    //
    // This test catches regressions in `EventDef<TPayload, TName>` and
    // the `<const TInner>` inference in `defineFeature`/`defineEvent`
    // — both have to cooperate so that `placed.name` resolves as a
    // literal into the `KumikoEventTypeMap` key.
    //
    // Setup: `setupAppWithExports` returns `{ placed }` from the
    // defineFeature callback so handler modules can read it as
    // `ordersFeature.exports.placed.name`.
    const appRoot = setupAppWithExports();
    runCodegen({ appRoot });

    write(
      appRoot,
      "src/feature/handler-byname.ts",
      `import { defineWriteHandler } from "../../.kumiko/define";
import { z } from "zod";
import { ordersFeature } from "./feature";

const { placed } = ordersFeature.exports;

export const placeOrder = defineWriteHandler({
  name: "orders.placeOrder",
  schema: z.object({}),
  access: { roles: ["Admin"] },
  handler: async (_event, ctx) => {
    await ctx.appendEvent({
      aggregateId: "x",
      aggregateType: "order",
      type: placed.name,
      payload: { orderId: "o1", customerId: "c1", amount: 99 },
    });
    return { isSuccess: true as const, data: { id: "o1" } };
  },
});
`,
    );

    const goodDiagnostics = compileApp(appRoot);
    const goodErrors = goodDiagnostics.filter((d) =>
      d.file?.fileName.endsWith("/feature/handler-byname.ts"),
    );
    if (goodErrors.length > 0) {
      const msgs = goodErrors
        .map((d) => `  TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`)
        .join("\n");
      throw new Error(`expected handler-byname.ts to compile cleanly, got:\n${msgs}`);
    }

    // Negative-Case: bad payload (extra property) → TS2353. Der
    // entscheidende Punkt — wenn `placed.name` zu `string` kollabiert
    // wäre, würde TS hier eine `Record<string, unknown>` annehmen und
    // die extra property NICHT melden. TS2353 hier beweist die
    // literal-typed Auflösung über `.name`.
    write(
      appRoot,
      "src/feature/handler-byname.ts",
      `import { defineWriteHandler } from "../../.kumiko/define";
import { z } from "zod";
import { ordersFeature } from "./feature";

const { placed } = ordersFeature.exports;

export const placeOrder = defineWriteHandler({
  name: "orders.placeOrder",
  schema: z.object({}),
  access: { roles: ["Admin"] },
  handler: async (_event, ctx) => {
    await ctx.appendEvent({
      aggregateId: "x",
      aggregateType: "order",
      type: placed.name,
      payload: { orderId: "o1", customerId: "c1", amount: 99, bogus: "extra" },
    });
    return { isSuccess: true as const, data: { id: "o1" } };
  },
});
`,
    );

    const badDiagnostics = compileApp(appRoot);
    const badErrors = badDiagnostics.filter((d) =>
      d.file?.fileName.endsWith("/feature/handler-byname.ts"),
    );
    const propErrors = badErrors.filter((d) => d.code === 2353);
    expect(propErrors.length).toBeGreaterThan(0);
    const flattened = propErrors
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))
      .join("\n");
    expect(flattened).toMatch(/'bogus'/);
  });
});
