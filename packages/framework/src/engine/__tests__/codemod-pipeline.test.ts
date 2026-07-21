import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Bun.Glob is only used by scanForCandidates / runCodemod. Emulate
// **/*.write.ts via node:fs so scan/convert paths stay testable.
function collectWriteTsRelPaths(rootDir: string, dir = rootDir, prefix = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const rel = prefix ? `${prefix}/${name}` : name;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...collectWriteTsRelPaths(rootDir, full, rel));
    } else if (name.endsWith(".write.ts")) {
      out.push(rel);
    }
  }
  return out;
}

mock.module("bun", () => {
  class FsGlob {
    constructor(private readonly pattern: string) {}
    scanSync(rootDir: string): string[] {
      if (this.pattern !== "**/*.write.ts") return [];
      return collectWriteTsRelPaths(rootDir).sort();
    }
  }
  return { Glob: FsGlob };
});

import {
  analyzeFile,
  analyzeHandlerArrow,
  convertFile,
  generatePerformBlock,
  runCodemod,
  scanForCandidates,
} from "../codemod/index";

const tmpDir = join(__dirname, "__codemod_fixtures__");

function writeFixture(name: string, content: string): string {
  const p = join(tmpDir, name);
  writeFileSync(p, content, "utf8");
  return p;
}

function writeFixtureIn(dir: string, name: string, content: string): string {
  const p = join(dir, name);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, content, "utf8");
  return p;
}

function freshScanRoot(name: string): string {
  const dir = join(tmpDir, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

beforeAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── Fixture helpers ──────────────────────────────────────────────

const staticReturnContent = `\
import { access, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

export const myHandler = defineWriteHandler({
  name: "test:static",
  schema: z.object({}),
  access: { roles: access.authenticated },
  handler: async () => ({ isSuccess: true, data: { ok: true } }),
});
`;

const executorCreateContent = `\
import { access, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

export const myHandler = defineWriteHandler({
  name: "test:create",
  schema: z.object({ label: z.string() }),
  access: { roles: access.authenticated },
  handler: async (event, ctx) => {
    const result = await invoiceExecutor.create({ label: event.payload.label });
    return { isSuccess: true, data: result };
  },
});
`;

const executorUpdateContent = `\
import { access, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

export const myHandler = defineWriteHandler({
  name: "test:update",
  schema: z.object({ id: z.string(), changes: z.record(z.unknown()) }),
  access: { roles: access.authenticated },
  handler: async (event, ctx) => {
    const result = await invoiceExecutor.update({ id: event.payload.id, changes: event.payload.changes });
    return { isSuccess: true, data: result };
  },
});
`;

const complexContent = `\
import { access, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

export const myHandler = defineWriteHandler({
  name: "test:complex",
  schema: z.object({ value: z.number() }),
  access: { roles: access.authenticated },
  handler: async (event, ctx) => {
    if (event.payload.value < 0) {
      return { isSuccess: false, error: "negative" };
    }
    const result = await someExecutor.create({ value: event.payload.value });
    return { isSuccess: true, data: result };
  },
});
`;

const alreadyPipelineContent = `\
import { access, defineWriteHandler, stepsPipeline } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

export const myHandler = defineWriteHandler({
  name: "test:pipeline",
  schema: z.object({}),
  access: { roles: access.authenticated },
  perform: stepsPipeline(({ event, r }) => [
    r.step.return((ctx) => ({ isSuccess: true, data: { ok: true } })),
  ]),
});
`;

const queryHandlerContent = `\
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

export const myQuery = defineQueryHandler({
  name: "test:query",
  schema: z.object({}),
  handler: async (query, ctx) => ({ items: [] }),
});
`;

const noHandlerContent = `\
export const irrelevant = 42;
`;

// ── Tests ───────────────────────────────────────────────────────

describe("analyzeFile", () => {
  it("returns null for non-existent file", () => {
    expect(analyzeFile("/nonexistent/file.ts")).toBeNull();
  });

  it("returns null for file without defineWriteHandler/defineQueryHandler", () => {
    const p = writeFixture("no-handler.ts", noHandlerContent);
    expect(analyzeFile(p)).toBeNull();
  });

  it("detects free-form write handler", () => {
    const p = writeFixture("freeform.write.ts", staticReturnContent);
    const result = analyzeFile(p);
    expect(result).not.toBeNull();
    expect(result!.pattern).toBe("free-form-write");
    expect(result!.convertible).toBe(true);
    expect(result!.reason).toBe("free_form_write_handler");
  });

  it("detects already-converted pipeline write handler", () => {
    const p = writeFixture("already-pipeline.write.ts", alreadyPipelineContent);
    const result = analyzeFile(p);
    expect(result).not.toBeNull();
    expect(result!.pattern).toBe("pipeline-write");
    expect(result!.convertible).toBe(false);
    expect(result!.reason).toBe("already_uses_pipeline_form");
  });

  it("detects query handler as non-convertible", () => {
    const p = writeFixture("query-handler.write.ts", queryHandlerContent);
    const result = analyzeFile(p);
    expect(result).not.toBeNull();
    expect(result!.pattern).toBe("query-handler");
    expect(result!.convertible).toBe(false);
    expect(result!.reason).toBe("query_handlers_not_convertible");
  });
});

describe("convertFile", () => {
  describe("static return handler", () => {
    it("converts handler to perform: stepsPipeline(...)", async () => {
      const p = writeFixture("static-convert.write.ts", staticReturnContent);
      const result = await convertFile(p);
      expect(result.status).toBe("converted");
      const content = readFileSync(p, "utf8");
      expect(content).toContain("perform: stepsPipeline");
      expect(content).toContain("r.step.return");
      expect(content).toContain("import { access, defineWriteHandler, stepsPipeline }");
      expect(content).not.toContain("handler:");
    });

    it("preserves schema reference in type parameter", async () => {
      const content = `\
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
const MySchema = z.object({ x: z.number() });
export const h = defineWriteHandler({
  name: "test",
  schema: MySchema,
  handler: async () => ({ isSuccess: true, data: { x: 1 } }),
});`;
      const p = writeFixture("schema-ref.write.ts", content);
      const result = await convertFile(p);
      expect(result.status).toBe("converted");
      const converted = readFileSync(p, "utf8");
      expect(converted).toContain("stepsPipeline<typeof MySchema, unknown>");
    });
  });

  describe("executor.create handler", () => {
    it("converts executor.create + return to pipeline", async () => {
      const p = writeFixture("executor-create-convert.write.ts", executorCreateContent);
      const result = await convertFile(p);
      expect(result.status).toBe("converted");
      const content = readFileSync(p, "utf8");
      expect(content).toContain("r.step.aggregate.create");
      expect(content).toContain("r.step.return");
      expect(content).not.toContain("handler:");
    });

    it("skips executor.create when return is multi-line (known limitation)", async () => {
      const content = `\
import { access, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

export const h = defineWriteHandler({
  name: "test",
  schema: z.object({}),
  access: { roles: access.authenticated },
  handler: async (event, ctx) => {
    const result = await invoiceExecutor.create({ label: "x" });
    return {
      isSuccess: true,
      data: result,
    };
  },
});`;
      const p = writeFixture("multi-line-ret.write.ts", content);
      const result = await convertFile(p);
      expect(result.status).toBe("converted");
      const converted = readFileSync(p, "utf8");
      expect(converted).toContain("r.step.aggregate.create");
      expect(converted).toContain("r.step.return");
    });
  });

  describe("executor.update handler", () => {
    it("converts executor.update + return to pipeline", async () => {
      const p = writeFixture("executor-update-convert.write.ts", executorUpdateContent);
      const result = await convertFile(p);
      expect(result.status).toBe("converted");
      const content = readFileSync(p, "utf8");
      expect(content).toContain("r.step.aggregate.update");
      expect(content).toContain("r.step.return");
    });
  });

  describe("non-convertible handlers", () => {
    it("skips handlers with conditional logic", async () => {
      const p = writeFixture("complex-skip.write.ts", complexContent);
      const result = await convertFile(p);
      expect(result.status).toBe("skipped");
    });

    it("skips already-converted pipeline handlers", async () => {
      const p = writeFixture("already-pipeline-convert.write.ts", alreadyPipelineContent);
      const result = await convertFile(p);
      expect(result.status).toBe("skipped");
      expect(result.reason).toContain("no convertible handler");
    });
  });

  describe("import injection", () => {
    it("adds pipeline import when not present", async () => {
      const p = writeFixture("import-add.write.ts", staticReturnContent);
      const result = await convertFile(p);
      expect(result.status).toBe("converted");
      const content = readFileSync(p, "utf8");
      expect(content).toContain("import { access, defineWriteHandler, stepsPipeline }");
    });

    it("does not duplicate pipeline import when already present", async () => {
      const content = `\
import { access, defineWriteHandler, stepsPipeline } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

export const h = defineWriteHandler({
  name: "test:dup",
  schema: z.object({}),
  handler: async () => ({ isSuccess: true, data: { ok: true } }),
});`;
      const p = writeFixture("import-already.write.ts", content);
      const result = await convertFile(p);
      expect(result.status).toBe("converted");
      const final = readFileSync(p, "utf8").split("\n");
      const pipelineImports = final.filter(
        (l) => l.includes("import") && l.includes("stepsPipeline"),
      );
      // Only one import line should contain "pipeline"
      expect(pipelineImports.length).toBe(1);
    });
  });

  describe("edge cases", () => {
    it("handles multiple defineWriteHandler calls in one file", async () => {
      const content = `\
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
export const h1 = defineWriteHandler({
  name: "test:a",
  schema: z.object({}),
  handler: async () => ({ isSuccess: true, data: { a: 1 } }),
});
export const h2 = defineWriteHandler({
  name: "test:b",
  schema: z.object({}),
  handler: async () => ({ isSuccess: true, data: { b: 2 } }),
});`;
      const p = writeFixture("multi-handler.write.ts", content);
      const result = await convertFile(p);
      expect(result.status).toBe("converted");
      const final = readFileSync(p, "utf8");
      // Both handlers should be converted
      expect(final.match(/perform:/g)?.length).toBe(2);
      expect(final.match(/r\.step\.return/g)?.length).toBe(2);
    });

    it("dry-run does not modify the file", async () => {
      const p = writeFixture("dryrun.write.ts", staticReturnContent);
      const original = readFileSync(p, "utf8");
      const result = await convertFile(p, undefined, { dryRun: true });
      expect(result.status).toBe("converted");
      // File should be unchanged
      expect(readFileSync(p, "utf8")).toBe(original);
    });

    it("converts expression-body executor.create handler", async () => {
      const content = `\
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

export const h = defineWriteHandler({
  name: "test:expr-create",
  schema: z.object({ label: z.string() }),
  handler: async (event, ctx) => invoiceExecutor.create(event.payload),
});`;
      const p = writeFixture("expr-create.write.ts", content);
      const result = await convertFile(p);
      expect(result.status).toBe("converted");
      const converted = readFileSync(p, "utf8");
      expect(converted).toContain("r.step.aggregate.create");
      expect(converted).toContain("ctx.event.payload");
      expect(converted).toContain("r.step.return");
    });

    it("converts guarded executor.create handler with if-guard", async () => {
      const content = `\
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

export const h = defineWriteHandler({
  name: "test:guarded",
  schema: z.object({ label: z.string() }),
  handler: async (event, ctx) => {
    const result = await invoiceExecutor.create({ label: event.payload.label });
    if (!result.isSuccess) {
      return { isSuccess: false, error: result.error };
    }
    return { isSuccess: true, data: result.data };
  },
});`;
      const p = writeFixture("guarded-create.write.ts", content);
      const result = await convertFile(p);
      expect(result.status).toBe("converted");
      const converted = readFileSync(p, "utf8");
      expect(converted).toContain("r.step.aggregate.create");
      expect(converted).toContain("r.step.compute");
      expect(converted).toContain("ctx.steps.result");
      expect(converted).toContain("r.step.return((ctx) => ctx.steps.outcome)");
    });

    it("converts expression-body executor.update handler", async () => {
      const content = `\
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

export const h = defineWriteHandler({
  name: "test:expr-update",
  schema: z.object({ id: z.string(), changes: z.record(z.unknown()) }),
  handler: async (event, ctx) => invoiceExecutor.update({ id: event.payload.id, changes: event.payload.changes }),
});`;
      const p = writeFixture("expr-update.write.ts", content);
      const result = await convertFile(p);
      expect(result.status).toBe("converted");
      const converted = readFileSync(p, "utf8");
      expect(converted).toContain("r.step.compute");
      expect(converted).toContain("ctx.event.payload");
      expect(converted).toContain("r.step.return");
    });

    it("returns error for malformed file", async () => {
      const p = writeFixture("malformed.write.ts", "this is not valid ts @@@@");
      const result = await convertFile(p);
      // ts-morph should handle this gracefully (parse error → no call found)
      expect(result.status).toBe("skipped");
    });

    it("returns error when the path is not a readable file", async () => {
      const dirPath = join(tmpDir, "dir-not-file.write.ts");
      rmSync(dirPath, { recursive: true, force: true });
      mkdirSync(dirPath, { recursive: true });
      const result = await convertFile(dirPath);
      expect(result.status).toBe("error");
      expect(result.reason).toBeDefined();
    });

    it("verbose logs when skipping a non-trivial handler", async () => {
      const p = writeFixture("verbose-skip-file.write.ts", complexContent);
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };
      try {
        const result = await convertFile(p, undefined, { verbose: true });
        expect(result.status).toBe("skipped");
        expect(logs.some((l) => l.includes("non-trivial handler"))).toBe(true);
      } finally {
        console.log = origLog;
      }
    });
  });
});

describe("analyzeHandlerArrow", () => {
  it("detects static return handler", () => {
    const result = analyzeHandlerArrow("async () => ({ isSuccess: true, data: { ok: true } })");
    expect(result.isStaticReturn).toBe(true);
    expect(result.isSimpleExecutorCreate).toBe(false);
    expect(result.isSimpleExecutorUpdate).toBe(false);
    expect(result.hasConditionalLogic).toBe(false);
  });

  it("detects executor.create + return handler", () => {
    const result = analyzeHandlerArrow(`async (event, ctx) => {
      const result = await invoiceExecutor.create({ label: event.payload.label });
      return { isSuccess: true, data: result };
    }`);
    expect(result.isStaticReturn).toBe(false);
    expect(result.isSimpleExecutorCreate).toBe(true);
    expect(result.executorName).toBe("invoiceExecutor");
    expect(result.executorCreateVar).toBe("result");
    expect(result.hasConditionalLogic).toBe(false);
  });

  it("detects executor.create with multi-line return", () => {
    const result = analyzeHandlerArrow(`async (event, ctx) => {
      const result = await invoiceExecutor.create({ label: event.payload.label });
      return {
        isSuccess: true,
        data: result,
      };
    }`);
    expect(result.isSimpleExecutorCreate).toBe(true);
  });

  it("detects executor.update + return handler", () => {
    const result = analyzeHandlerArrow(`async (event, ctx) => {
      const result = await invoiceExecutor.update({ id: event.payload.id, changes: event.payload.changes });
      return { isSuccess: true, data: result };
    }`);
    expect(result.isSimpleExecutorUpdate).toBe(true);
    expect(result.executorName).toBe("invoiceExecutor");
    expect(result.hasConditionalLogic).toBe(false);
  });

  it("flags handlers with conditional logic", () => {
    const result = analyzeHandlerArrow(`async (event, ctx) => {
      if (event.payload.value < 0) {
        return { isSuccess: false, error: "negative" };
      }
      const r = await executor.create({ value: event.payload.value });
      return { isSuccess: true, data: r };
    }`);
    expect(result.hasConditionalLogic).toBe(true);
    expect(result.isSimpleExecutorCreate).toBe(false);
  });

  it("ignores expression-body handlers (non-object)", () => {
    const result = analyzeHandlerArrow("async (event, ctx) => crud.create(event.payload)");
    expect(result.isStaticReturn).toBe(false);
    expect(result.isSimpleExecutorCreate).toBe(false);
  });

  it("detects expression-body executor.create", () => {
    const result = analyzeHandlerArrow(
      "async (event, ctx) => invoiceExecutor.create(event.payload)",
    );
    expect(result.isExpressionBodyCreate).toBe(true);
    expect(result.executorName).toBe("invoiceExecutor");
    expect(result.expressionBodyArgs).toEqual(["event.payload"]);
  });

  it("detects expression-body executor.update", () => {
    const result = analyzeHandlerArrow(
      "async (event, ctx) => invoiceExecutor.update({ id: event.payload.id, changes: event.payload.changes })",
    );
    expect(result.isExpressionBodyUpdate).toBe(true);
    expect(result.executorName).toBe("invoiceExecutor");
    expect(result.expressionBodyArgs).toHaveLength(1);
  });

  it("detects guarded executor.create with if-guard", () => {
    const result = analyzeHandlerArrow(`async (event, ctx) => {
      const result = await invoiceExecutor.create({ label: event.payload.label });
      if (!result.isSuccess) {
        return { isSuccess: false, error: result.error };
      }
      return { isSuccess: true, data: result.data };
    }`);
    expect(result.isGuardedCreate).toBe(true);
    expect(result.executorName).toBe("invoiceExecutor");
    expect(result.guardConfig).toBeDefined();
    expect(result.guardConfig!.condition).toBe("!result.isSuccess");
    expect(result.guardConfig!.failureReturn).toContain("isSuccess: false");
    expect(result.guardConfig!.successReturn).toContain("isSuccess: true");
    expect(result.hasConditionalLogic).toBe(true);
  });

  it("detects guarded handler correctly, not as simple create", () => {
    // A handler with if-guard should NOT be classified as simple create
    const result = analyzeHandlerArrow(`async (event, ctx) => {
      const result = await invoiceExecutor.create({ label: event.payload.label });
      if (!result.isSuccess) {
        return { isSuccess: false, error: result.error };
      }
      return { isSuccess: true, data: result.data };
    }`);
    expect(result.isGuardedCreate).toBe(true);
    expect(result.isSimpleExecutorCreate).toBe(false);
  });

  it("returns non-convertible defaults for async ( without =>", () => {
    const result = analyzeHandlerArrow("async (event, ctx) { return { isSuccess: true } }");
    expect(result.isStaticReturn).toBe(false);
    expect(result.isSimpleExecutorCreate).toBe(false);
    expect(result.isSimpleExecutorUpdate).toBe(false);
    expect(result.hasConditionalLogic).toBe(false);
    expect(result.isExpressionBodyCreate).toBe(false);
    expect(result.isGuardedCreate).toBe(false);
  });
});

describe("scanForCandidates", () => {
  it("returns empty list when no *.write.ts files exist", () => {
    const root = freshScanRoot("scan-empty");
    expect(scanForCandidates(root)).toEqual([]);
  });

  it("finds and classifies *.write.ts fixtures under rootDir", () => {
    const root = freshScanRoot("scan-mixed");
    writeFixtureIn(root, "freeform.write.ts", staticReturnContent);
    writeFixtureIn(root, "already-pipeline.write.ts", alreadyPipelineContent);
    writeFixtureIn(root, "nested/deep.write.ts", queryHandlerContent);

    const results = scanForCandidates(root);
    expect(results.map((r) => r.filePath).sort()).toEqual(
      [
        join(root, "already-pipeline.write.ts"),
        join(root, "freeform.write.ts"),
        join(root, "nested/deep.write.ts"),
      ].sort(),
    );
    expect(results.find((r) => r.pattern === "free-form-write")?.convertible).toBe(true);
    expect(results.find((r) => r.pattern === "pipeline-write")?.convertible).toBe(false);
    expect(results.find((r) => r.pattern === "query-handler")?.convertible).toBe(false);
  });
});

describe("runCodemod", () => {
  it("returns empty report when scan finds no convertible handlers", async () => {
    const root = freshScanRoot("run-empty");
    const report = await runCodemod(root);
    expect(report).toEqual({ results: [], converted: 0, skipped: 0, errors: 0 });
  });

  it("converts free-form write handlers discovered by scan", async () => {
    const root = freshScanRoot("run-convert");
    const p = writeFixtureIn(root, "to-convert.write.ts", staticReturnContent);
    const report = await runCodemod(root);
    expect(report.converted).toBe(1);
    expect(report.skipped).toBe(0);
    expect(report.errors).toBe(0);
    expect(readFileSync(p, "utf8")).toContain("perform: stepsPipeline");
  });

  it("verbose logs per-file outcomes", async () => {
    const root = freshScanRoot("run-verbose");
    writeFixtureIn(root, "verbose-convert.write.ts", staticReturnContent);
    writeFixtureIn(root, "verbose-skip.write.ts", complexContent);

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      const report = await runCodemod(root, { verbose: true });
      expect(report.converted).toBe(1);
      expect(report.skipped).toBe(1);
      expect(logs.some((l) => l.includes("verbose-convert.write.ts"))).toBe(true);
      expect(logs.some((l) => l.includes("verbose-skip.write.ts"))).toBe(true);
    } finally {
      console.log = origLog;
    }
  });
});

describe("generatePerformBlock", () => {
  it("generates pipeline block for static return", () => {
    const analysis = analyzeHandlerArrow("async () => ({ isSuccess: true, data: { ok: true } })");
    const block = generatePerformBlock(analysis, "", "  ");
    expect(block).toContain("perform: stepsPipeline(");
    expect(block).toContain("r.step.return((ctx) => ({ isSuccess: true, data: { ok: true } })");
  });

  it("generates pipeline block with schema type parameter", () => {
    const analysis = analyzeHandlerArrow("async () => ({ isSuccess: true, data: { ok: true } })");
    const block = generatePerformBlock(analysis, "typeof InvoiceSchema", "  ");
    expect(block).toContain("stepsPipeline<typeof InvoiceSchema, unknown>");
  });

  it("returns null for non-convertible analysis", () => {
    const analysis = analyzeHandlerArrow(`async (event, ctx) => {
      if (event.payload.x) { return { isSuccess: true, data: null }; }
      return { isSuccess: false, error: "no" };
    }`);
    const block = generatePerformBlock(analysis, "", "  ");
    expect(block).toBeNull();
  });

  it("generates pipeline block for guarded executor.create", () => {
    const analysis = analyzeHandlerArrow(`async (event, ctx) => {
      const result = await invoiceExecutor.create({ label: event.payload.label });
      if (!result.isSuccess) {
        return { isSuccess: false, error: result.error };
      }
      return { isSuccess: true, data: result.data };
    }`);
    const block = generatePerformBlock(analysis, "", "  ");
    expect(block).toContain("r.step.aggregate.create");
    expect(block).toContain('r.step.compute("outcome"');
    expect(block).toContain("ctx.steps.result.isSuccess");
    expect(block).toContain("return { isSuccess: false, error: ctx.steps.result.error }");
    expect(block).toContain("return { isSuccess: true, data: ctx.steps.result.data }");
    expect(block).toContain("r.step.return((ctx) => ctx.steps.outcome)");
  });
});
