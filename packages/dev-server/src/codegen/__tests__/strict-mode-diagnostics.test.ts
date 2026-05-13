import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as ts from "typescript";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { runCodegen } from "../run-codegen";

const REPO_ROOT = join(__dirname, "../../../../..");
const FRAMEWORK_SRC = join(REPO_ROOT, "packages/framework/src");

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
    }
  }
  try {
    rmSync(TEST_FIXTURE_DIR, { recursive: true, force: true });
  } catch {
  }
});

function write(dir: string, relPath: string, content: string): string {
  const full = join(dir, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, "utf-8");
  return full;
}

function compileApp(appRoot: string): readonly ts.Diagnostic[] {
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
      "@cosmicdrift/kumiko-framework/*": [join(FRAMEWORK_SRC, "*/index.ts")],
    },
    types: [],
  };

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

function writeOrderPlacedSchema(appRoot: string): void {
  write(
    appRoot,
    "src/feature/events.ts",
    [
      'import { z } from "zod";',
      "export const orderPlacedSchema = z.object({",
      "  orderId: z.string(),",
      "  customerId: z.string(),",
      "  amount: z.number(),",
      "});",
      "",
    ].join("\n"),
  );
}

const STRICT_MODE_TIMEOUT_MS = 120_000;

describe("strict-mode diagnostics -- the actual contract of the codegen", () => {
  let appRoot: string;
  let allDiagnostics: readonly ts.Diagnostic[];

  beforeAll(() => {
    appRoot = makeAppDir();
    writeOrderPlacedSchema(appRoot);
    write(
      appRoot,
      "src/feature/feature.ts",
      [
        'import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";',
        'import { orderPlacedSchema } from "./events";',
        "",
        "export const ordersFeature = defineFeature(\"orders\", (r) => ({",
        '  placed: r.defineEvent("placed", orderPlacedSchema),',
        "}));",
        "",
      ].join("\n"),
    );
    runCodegen({ appRoot });

    write(
      appRoot,
      "src/feature/handler-good.ts",
      [
        'import { defineWriteHandler } from "../../.kumiko/define";',
        'import { z } from "zod";',
        "",
        "export const placeOrder = defineWriteHandler({",
        '  name: "orders.placeOrder",',
        "  schema: z.object({}),",
        '  access: { roles: ["Admin"] },',
        "  handler: async (_event, ctx) => {",
        "    await ctx.appendEvent({",
        '      aggregateId: "x",',
        '      aggregateType: "order",',
        '      type: "orders:event:placed",',
        "      payload: { orderId: \"o1\", customerId: \"c1\", amount: 99 },",
        "    });",
        '    return { isSuccess: true as const, data: { id: "o1" } };',
        "  },",
        "});",
        "",
      ].join("\n"),
    );

    write(
      appRoot,
      "src/feature/handler-unknown-type.ts",
      [
        'import { defineWriteHandler } from "../../.kumiko/define";',
        'import { z } from "zod";',
        "",
        "export const placeOrder = defineWriteHandler({",
        '  name: "orders.placeOrder",',
        "  schema: z.object({}),",
        '  access: { roles: ["Admin"] },',
        "  handler: async (_event, ctx) => {",
        "    await ctx.appendEvent({",
        '      aggregateId: "x",',
        '      aggregateType: "order",',
        '      type: "totally:made:up",',
        "      payload: { whatever: 1 },",
        "    });",
        '    return { isSuccess: true as const, data: { id: "x" } };',
        "  },",
        "});",
        "",
      ].join("\n"),
    );

    write(
      appRoot,
      "src/feature/handler-payload-mismatch.ts",
      [
        'import { defineWriteHandler } from "../../.kumiko/define";',
        'import { z } from "zod";',
        "",
        "export const placeOrder = defineWriteHandler({",
        '  name: "orders.placeOrder",',
        "  schema: z.object({}),",
        '  access: { roles: ["Admin"] },',
        "  handler: async (_event, ctx) => {",
        "    await ctx.appendEvent({",
        '      aggregateId: "x",',
        '      aggregateType: "order",',
        '      type: "orders:event:placed",',
        "      payload: { orderId: \"o1\", customerId: \"c1\", amount: 99, bogus: \"extra\" },",
        "    });",
        '    return { isSuccess: true as const, data: { id: "o1" } };',
        "  },",
        "});",
        "",
      ].join("\n"),
    );

    write(
      appRoot,
      "src/feature/handler-direct.ts",
      [
        'import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";',
        'import { z } from "zod";',
        "",
        "export const placeOrder = defineWriteHandler({",
        '  name: "orders.placeOrder",',
        "  schema: z.object({}),",
        '  access: { roles: ["Admin"] },',
        "  handler: async (_event, ctx) => {",
        "    await ctx.appendEvent({",
        '      aggregateId: "x",',
        '      aggregateType: "order",',
        '      type: "orders:event:placed",',
        "      payload: { orderId: \"o1\", customerId: \"c1\", amount: 99 },",
        "    });",
        '    return { isSuccess: true as const, data: { id: "o1" } };',
        "  },",
        "});",
        "",
      ].join("\n"),
    );

    write(
      appRoot,
      "src/feature/handler-byname-good.ts",
      [
        'import { defineWriteHandler } from "../../.kumiko/define";',
        'import { z } from "zod";',
        'import { ordersFeature } from "./feature";',
        "",
        "const { placed } = ordersFeature.exports;",
        "",
        "export const placeOrder = defineWriteHandler({",
        '  name: "orders.placeOrder",',
        "  schema: z.object({}),",
        '  access: { roles: ["Admin"] },',
        "  handler: async (_event, ctx) => {",
        "    await ctx.appendEvent({",
        '      aggregateId: "x",',
        '      aggregateType: "order",',
        "      type: placed.name,",
        "      payload: { orderId: \"o1\", customerId: \"c1\", amount: 99 },",
        "    });",
        '    return { isSuccess: true as const, data: { id: "o1" } };',
        "  },",
        "});",
        "",
      ].join("\n"),
    );

    write(
      appRoot,
      "src/feature/handler-byname-bad.ts",
      [
        'import { defineWriteHandler } from "../../.kumiko/define";',
        'import { z } from "zod";',
        'import { ordersFeature } from "./feature";',
        "",
        "const { placed } = ordersFeature.exports;",
        "",
        "export const placeOrder = defineWriteHandler({",
        '  name: "orders.placeOrder",',
        "  schema: z.object({}),",
        '  access: { roles: ["Admin"] },',
        "  handler: async (_event, ctx) => {",
        "    await ctx.appendEvent({",
        '      aggregateId: "x",',
        '      aggregateType: "order",',
        "      type: placed.name,",
        "      payload: { orderId: \"o1\", customerId: \"c1\", amount: 99, bogus: \"extra\" },",
        "    });",
        '    return { isSuccess: true as const, data: { id: "o1" } };',
        "  },",
        "});",
        "",
      ].join("\n"),
    );

    allDiagnostics = compileApp(appRoot);
  });

  test("good ctx.appendEvent compiles cleanly", () => {
    const handlerErrors = allDiagnostics.filter((d) =>
      d.file?.fileName.endsWith("/feature/handler-good.ts"),
    );
    expect(handlerErrors).toHaveLength(0);
  });

  test("unknown event-type triggers TS2322 with augmented map in error message", () => {
    const handlerErrors = allDiagnostics.filter((d) =>
      d.file?.fileName.endsWith("/feature/handler-unknown-type.ts"),
    );
    const ts2322 = handlerErrors.filter((d) => d.code === 2322);
    expect(ts2322.length).toBeGreaterThan(0);
    const flattened = ts2322
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))
      .join("\n");
    expect(flattened).toMatch(/keyof KumikoEventTypeMap|"orders:event:placed"/);
  });

  test("payload-shape mismatch triggers a property-error", () => {
    const handlerErrors = allDiagnostics.filter((d) =>
      d.file?.fileName.endsWith("/feature/handler-payload-mismatch.ts"),
    );
    const propErrors = handlerErrors.filter((d) => d.code === 2353);
    expect(propErrors.length).toBeGreaterThan(0);
    const flattened = propErrors
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))
      .join("\n");
    expect(flattened).toMatch(/'bogus'/);
  });

  test("direct framework-import + augmentation-included compiles strict too", () => {
    const handlerErrors = allDiagnostics.filter((d) =>
      d.file?.fileName.endsWith("/feature/handler-direct.ts"),
    );
    expect(handlerErrors).toHaveLength(0);
  });

  test("eventDef.name pattern: literal-typed name resolves to correct payload-shape", () => {
    const goodErrors = allDiagnostics.filter((d) =>
      d.file?.fileName.endsWith("/feature/handler-byname-good.ts"),
    );
    if (goodErrors.length > 0) {
      const msgs = goodErrors
        .map((d) => "  TS" + d.code + ": " + ts.flattenDiagnosticMessageText(d.messageText, "\n"))
        .join("\n");
      throw new Error("expected handler-byname-good.ts to compile cleanly, got:\n" + msgs);
    }

    const badErrors = allDiagnostics.filter((d) =>
      d.file?.fileName.endsWith("/feature/handler-byname-bad.ts"),
    );
    const propErrors = badErrors.filter((d) => d.code === 2353);
    expect(propErrors.length).toBeGreaterThan(0);
    const flattened = propErrors
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))
      .join("\n");
    expect(flattened).toMatch(/'bogus'/);
  });
});
