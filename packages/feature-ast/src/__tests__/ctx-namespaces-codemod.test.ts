import { afterAll, describe, expect, it, spyOn } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Project } from "ts-morph";
import { main as runCtxNamespaces } from "../scripts/codemod/ctx-namespaces.ts";
import { transformCtxNamespaces } from "../scripts/codemod/ctx-namespaces-transform.ts";

const FIXTURES_DIR = join(import.meta.dir, "fixtures", "ctx-namespaces");
const SCRIPT = join(import.meta.dir, "../scripts/codemod/ctx-namespaces.ts");

type Shape = "old" | "new";
const SHAPES: readonly Shape[] = ["old", "new"];

interface Case {
  readonly name: string;
  readonly rewrites: number;
  readonly manual: readonly (readonly [number, string])[];
  // The old context types still carry the flat members, so structural parameters are fine there.
  readonly manualOld?: readonly (readonly [number, string])[];
}

const REDIS_MOVED =
  "a handler or job context is passed to a parameter that reads redis, which moved to services.redis";

const CASES: readonly Case[] = [
  { name: "handler-body", rewrites: 10, manual: [] },
  { name: "job-body", rewrites: 5, manual: [] },
  {
    name: "destructuring",
    rewrites: 4,
    manual: [
      [15, "log: destructured with a default value"],
      [20, "destructuring with a rest element next to moved context members"],
      [26, "db is already bound next to dbOutsideTransaction"],
    ],
  },
  { name: "mocks", rewrites: 12, manual: [] },
  { name: "types", rewrites: 6, manual: [[8, "Omit of a moved context member"]] },
  { name: "phases", rewrites: 4, manual: [] },
  { name: "negatives", rewrites: 0, manual: [] },
  { name: "unresolved", rewrites: 0, manual: [[2, "appendEvent: receiver type does not resolve"]] },
  { name: "merge", rewrites: 2, manual: [] },
  {
    name: "spreads",
    rewrites: 3,
    manual: [
      [9, "db is already set to a non-literal next to dbOutsideTransaction"],
      [27, "write: moved member sits before a spread that carries dispatch"],
      [35, "write: a spread call may carry dispatch; spread its result by hand"],
      [42, "dbOutsideTransaction: a spread carrying db would break the TenantDb identity"],
    ],
  },
  { name: "phases-only", rewrites: 2, manual: [] },
  { name: "config-accessor", rewrites: 6, manual: [] },
  { name: "services", rewrites: 13, manual: [] },
  {
    name: "contracts",
    rewrites: 3,
    manual: [
      [18, "clock: boot wiring is no longer exposed on the context"],
      [22, "systemUser: removed from HandlerContext"],
      [22, "triggeredBy: removed from HandlerContext"],
      [22, "_tenantId: removed from HandlerContext, read ctx.user.tenantId"],
      [26, "a handler or job context is passed to an AppContext parameter"],
      [27, "a handler or job context is passed to an AppContext parameter"],
      [48, REDIS_MOVED],
      [49, REDIS_MOVED],
      [
        49,
        "a handler or job context is passed to a parameter that reads signal, which moved to lifecycle.signal",
      ],
    ],
    manualOld: [
      [18, "clock: boot wiring is no longer exposed on the context"],
      [22, "systemUser: removed from HandlerContext"],
      [22, "triggeredBy: removed from HandlerContext"],
      [22, "_tenantId: removed from HandlerContext, read ctx.user.tenantId"],
      [26, "a handler or job context is passed to an AppContext parameter"],
      [27, "a handler or job context is passed to an AppContext parameter"],
    ],
  },
  {
    name: "structural-types",
    rewrites: 11,
    manual: [
      [
        40,
        "a structural context type declared in another file reads query, which moved into context namespaces",
      ],
    ],
  },
  {
    name: "hooks",
    rewrites: 5,
    manual: [[7, "a handler or job context is passed to an AppContext parameter"]],
  },
];

const projects = new Map<Shape, Project>();

function projectFor(shape: Shape): Project {
  const existing = projects.get(shape);
  if (existing !== undefined) return existing;
  const created = new Project({
    tsConfigFilePath: join(FIXTURES_DIR, `tsconfig.${shape}.json`),
    skipAddingFilesFromTsConfig: true,
  });
  projects.set(shape, created);
  return created;
}

function caseFile(name: string, kind: "input" | "expected"): string {
  return join(FIXTURES_DIR, "cases", `${name}.${kind}.ts`);
}

function runCase(shape: Shape, name: string) {
  const sourceFile = projectFor(shape).addSourceFileAtPath(caseFile(name, "input"));
  return transformCtxNamespaces(sourceFile);
}

function runOn(shape: Shape, name: string, text: string) {
  const sourceFile = projectFor(shape).createSourceFile(
    join(FIXTURES_DIR, "cases", `${name}.second-pass.ts`),
    text,
    { overwrite: true },
  );
  return transformCtxNamespaces(sourceFile);
}

describe("ctx-namespaces codemod", () => {
  for (const shape of SHAPES) {
    describe(`against the ${shape} context types`, () => {
      for (const testCase of CASES) {
        it(`${testCase.name}: exact output and sites`, () => {
          const result = runCase(shape, testCase.name);

          expect(result.output).toBe(readFileSync(caseFile(testCase.name, "expected"), "utf8"));
          expect(result.rewrites).toHaveLength(testCase.rewrites);
          expect(result.manual.map((site) => [site.line, site.description])).toEqual(
            (shape === "old" ? (testCase.manualOld ?? testCase.manual) : testCase.manual).map(
              ([line, reason]) => [line, reason],
            ),
          );
        });

        it(`${testCase.name}: a second run changes nothing`, () => {
          const first = runCase(shape, testCase.name);
          const second = runOn(shape, testCase.name, first.output);

          expect(second.output).toBe(first.output);
          expect(second.rewrites).toHaveLength(0);
          expect(second.manual.map((site) => site.description)).toEqual(
            first.manual.map((site) => site.description),
          );
        });
      }
    });
  }

  it("resolves handler and job receivers, not the same-named members of other types", () => {
    const negatives = runCase("old", "negatives");
    const handler = runCase("old", "handler-body");

    expect(negatives.contextReceivers).toBe(0);
    expect(handler.contextReceivers).toBeGreaterThan(0);
  });

  it("drops the HandlerContext import once the phase rewrite leaves it unused", () => {
    const { output } = runCase("old", "phases-only");

    expect(output).not.toContain("HandlerContext");
  });

  it("rewrites the body of a hook whose AppContext annotation moves to HandlerContext", () => {
    const { output } = runCase("old", "hooks");

    expect(output).toContain("context: HandlerContext) =>");
    expect(output).toContain("context: HandlerContext & { readonly isNew: boolean }");
    expect(output).toContain("context.obs.log");
    expect(output).toContain("import type { AppContext, HandlerContext }");
  });

  it("moves a cast read of an unknown member to services.extensions", () => {
    const { output } = runCase("old", "contracts");

    expect(output).toContain("(ctx.services.extensions as { templateResolver?: Resolver })");
    expect(output).toContain("(job.services.extensions as { templateResolver?: Resolver })");
    expect(output).toContain("(ctx as { db?: unknown }).db");
  });

  it("adds the phase context types to the import that supplies HandlerContext", () => {
    const { output } = runCase("old", "phases");

    expect(output).toContain("ReservationContext");
    expect(output).toContain("BeforeTransactionContext");
    expect(output.match(/from "@cosmicdrift\/kumiko-types\/handlers"/g)).toHaveLength(1);
  });
});

describe("ctx-namespaces CLI", () => {
  const roots: string[] = [];
  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  function stageProject(): string {
    const root = mkdtempSync(join(tmpdir(), "ctx-namespaces-"));
    roots.push(root);
    cpSync(join(FIXTURES_DIR, "types-old"), join(root, "types-old"), { recursive: true });
    cpSync(join(FIXTURES_DIR, "tsconfig.old.json"), join(root, "tsconfig.json"));
    mkdirSync(join(root, "src"));
    return root;
  }

  // The bin smoke test (bad flag -> exit 2) spawns; everything else runs main() in-process.
  async function spawnCli(root: string, args: string[]) {
    const proc = Bun.spawn({
      cmd: ["bun", SCRIPT, join(root, "src"), "--no-format", ...args],
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    return { stdout, exitCode };
  }

  async function runCli(root: string, args: string[]) {
    const lines: string[] = [];
    const logSpy = spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
      lines.push(parts.join(" "));
    });
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const exitCode = await runCtxNamespaces([join(root, "src"), "--no-format", ...args]);
      return { stdout: lines.join("\n"), exitCode };
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  }

  it("--dry-run reports sites, leaves files alone and exits 0 even with manual sites", async () => {
    const root = stageProject();
    const target = join(root, "src", "destructuring.ts");
    const input = readFileSync(caseFile("destructuring", "input"), "utf8");
    writeFileSync(target, input);

    const { stdout, exitCode } = await runCli(root, ["--dry-run"]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("manual  log: destructured with a default value");
    expect(stdout).toContain("rewritable: 4 site(s) in 1 file(s); manual: 3");
    expect(readFileSync(target, "utf8")).toBe(input);
  });

  function stageHandlerBody(shape: "input" | "expected"): { root: string; target: string } {
    const root = stageProject();
    const target = join(root, "src", "handler-body.ts");
    writeFileSync(target, readFileSync(caseFile("handler-body", shape), "utf8"));
    return { root, target };
  }

  it("--check exits 1 on an unmigrated handler body", async () => {
    const { root } = stageHandlerBody("input");

    const { exitCode } = await runCli(root, ["--check"]);

    expect(exitCode).toBe(1);
  });

  it("writes the migrated handler body by default", async () => {
    const { root, target } = stageHandlerBody("input");

    const { exitCode } = await runCli(root, []);

    expect(exitCode).toBe(0);
    expect(readFileSync(target, "utf8")).toBe(
      readFileSync(caseFile("handler-body", "expected"), "utf8"),
    );
  });

  it("--check exits 0 on an already migrated handler body", async () => {
    const { root } = stageHandlerBody("expected");

    const { exitCode } = await runCli(root, ["--check"]);

    expect(exitCode).toBe(0);
  });

  it("rewrites a structural helper whose handler-context caller sits in another file", async () => {
    const root = stageProject();
    const helper = join(root, "src", "a-rows.ts");
    const caller = join(root, "src", "b-handler.ts");
    writeFileSync(
      helper,
      [
        "type RowsContext = { readonly query: (qn: string, payload: unknown) => Promise<unknown> };",
        "",
        "export async function loadRows(ctx: RowsContext) {",
        '  return ctx.query("rows:query:list", {});',
        "}",
        "",
      ].join("\n"),
    );
    writeFileSync(
      caller,
      [
        'import type { HandlerContext } from "@cosmicdrift/kumiko-types/handlers";',
        'import { loadRows } from "./a-rows.ts";',
        "",
        "export async function handler(ctx: HandlerContext) {",
        "  return loadRows(ctx);",
        "}",
        "",
      ].join("\n"),
    );

    const { exitCode } = await runCli(root, []);

    expect(exitCode).toBe(0);
    const migrated = readFileSync(helper, "utf8");
    expect(migrated).toContain('ctx.dispatch.query("rows:query:list", {})');
    expect(migrated).toContain("readonly dispatch: {");
  });

  it("rejects unknown flags with exit 2", async () => {
    const root = stageProject();

    const { exitCode } = await spawnCli(root, ["--bogus"]);

    expect(exitCode).toBe(2);
  });
});
