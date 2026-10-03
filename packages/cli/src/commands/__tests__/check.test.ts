import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RepoManifest } from "@cosmicdrift/kumiko-repo-manifest";
import type { Output } from "../../output";
import {
  type CheckDeps,
  type GuardsCli,
  resolveCheckSteps,
  runCheck,
  type SchemaCli,
} from "../check";

function manifest(overrides: Partial<RepoManifest> = {}): RepoManifest {
  return {
    kind: "app",
    sourceRoots: ["src"],
    testGlobs: ["src/**/*.test.ts"],
    uiRoots: [],
    ...overrides,
  };
}

function plan(m: RepoManifest, hasAppSchema = true, manifestSource: "file" | "derived" = "file") {
  return resolveCheckSteps(m, { hasAppSchema, manifestSource });
}

function stepsOf(m: RepoManifest, hasAppSchema = true) {
  const resolved = plan(m, hasAppSchema);
  if (resolved.kind === "error") throw new Error(resolved.message);
  return resolved;
}

function stepIds(m: RepoManifest, hasAppSchema = true): string[] {
  return stepsOf(m, hasAppSchema).steps.map((s) => s.id);
}

type Calls = {
  readonly guards: string[][];
  readonly ui: string[][];
  readonly checks: string[][];
  readonly schema: string[][];
  readonly schemaCwd: string[];
};

type Harness = {
  readonly deps: CheckDeps;
  readonly calls: Calls;
  readonly logs: string[];
  readonly errs: string[];
  readonly out: Output;
  readonly cwd: string;
  readonly repoDir: string;
};

const tmpRepos: string[] = [];

afterEach(() => {
  for (const dir of tmpRepos.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// The repo the stubbed findLocalRepo points at — runCheck reads kumiko/schema.ts
// from it to decide whether the boot step applies.
function tmpRepo(withAppSchema: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), "kumiko-check-"));
  tmpRepos.push(dir);
  if (withAppSchema) {
    mkdirSync(join(dir, "kumiko"), { recursive: true });
    writeFileSync(join(dir, "kumiko", "schema.ts"), "export const ENTITY_METAS = [];\n");
  }
  return dir;
}

function harness(
  options: {
    readonly repoManifest?: RepoManifest;
    readonly repoMissing?: boolean;
    readonly manifestSource?: "file" | "derived";
    readonly appSchemaMissing?: boolean;
    readonly guardsLoadError?: Error;
    readonly schemaLoadError?: Error;
    readonly exitCodes?: Partial<Record<"guards" | "ui" | "checks" | "schema", number>>;
  } = {},
): Harness {
  const calls: Calls = { guards: [], ui: [], checks: [], schema: [], schemaCwd: [] };
  const logs: string[] = [];
  const errs: string[] = [];
  const codes = options.exitCodes ?? {};
  const repoDir = tmpRepo(options.appSchemaMissing !== true);

  const guardsCli: GuardsCli = {
    cliFlagsError: (subcommand, argv, known) => {
      const unknown = argv.filter((a) => !known.includes(a));
      return unknown.length === 0
        ? undefined
        : `Unknown argument for "${subcommand}": ${unknown.join(", ")}`;
    },
    findLocalRepo: () =>
      options.repoMissing
        ? undefined
        : {
            name: "test-repo",
            absPath: repoDir,
            kind: (options.repoManifest ?? manifest()).kind,
            manifest: options.repoManifest ?? manifest(),
            manifestSource: options.manifestSource ?? "file",
          },
    runGuardsCli: (argv) => {
      calls.guards.push([...argv]);
      return codes.guards ?? 0;
    },
    runUiGuardsCli: (argv) => {
      calls.ui.push([...argv]);
      return codes.ui ?? 0;
    },
    runRepoChecksCli: async (argv) => {
      calls.checks.push([...argv]);
      return codes.checks ?? 0;
    },
  };

  const schemaCli: SchemaCli = {
    runSchemaCli: async (argv, appCwd) => {
      calls.schema.push([...argv]);
      calls.schemaCwd.push(appCwd);
      return codes.schema ?? 0;
    },
  };

  return {
    calls,
    logs,
    errs,
    cwd: process.cwd(),
    repoDir,
    out: { log: (l) => logs.push(l), err: (l) => errs.push(l) },
    deps: {
      loadGuards: async () => {
        if (options.guardsLoadError) throw options.guardsLoadError;
        return guardsCli;
      },
      loadSchemaCli: async () => {
        if (options.schemaLoadError) throw options.schemaLoadError;
        return schemaCli;
      },
    },
  };
}

describe("resolveCheckSteps", () => {
  test('kind "app" with uiRoots resolves boot, guards, ui, checks', () => {
    expect(stepIds(manifest({ uiRoots: ["src/**/web"] }))).toEqual([
      "boot",
      "guards",
      "ui",
      "checks",
    ]);
  });

  test('kind "library" has no boot step — no kumiko/schema.ts to validate', () => {
    expect(stepIds(manifest({ kind: "library" }))).toEqual(["guards", "checks"]);
  });

  test('kind "framework" with uiRoots runs the UI suite but not boot', () => {
    expect(stepIds(manifest({ kind: "framework", uiRoots: ["packages/*/src/**/web"] }))).toEqual([
      "guards",
      "ui",
      "checks",
    ]);
  });

  test("empty uiRoots on an app drops the UI step and records a waiver", () => {
    const resolved = stepsOf(manifest({ uiRoots: [] }));
    expect(resolved.steps.map((s) => s.id)).toEqual(["boot", "guards", "checks"]);
    expect(resolved.waivers.join("\n")).toContain("uiRoots is []");
  });

  test('kind "app" without uiRoots is an error naming uiRoots', () => {
    const resolved = plan(manifest({ uiRoots: undefined }));
    expect(resolved.kind).toBe("error");
    if (resolved.kind === "error") {
      expect(resolved.message).toContain("uiRoots: []");
      expect(resolved.message).not.toContain("Add a kumiko.json");
    }
  });

  test("a derived manifest additionally hints at adding a kumiko.json", () => {
    const resolved = plan(manifest({ uiRoots: undefined }), true, "derived");
    expect(resolved.kind === "error" && resolved.message).toContain("Add a kumiko.json");
  });

  test('kind "library" without uiRoots keeps silently skipping the UI step', () => {
    const resolved = stepsOf(manifest({ kind: "library", uiRoots: undefined }));
    expect(resolved.steps.map((s) => s.id)).toEqual(["guards", "checks"]);
    expect(resolved.waivers).toEqual([]);
  });

  test('kind "tooling" resolves no steps at all', () => {
    expect(stepIds(manifest({ kind: "tooling", uiRoots: ["src/**/web"] }))).toEqual([]);
  });

  test('a kind "app" repo without kumiko/schema.ts gets no boot step', () => {
    expect(stepIds(manifest(), false)).toEqual(["guards", "checks"]);
  });

  test("every step states why it was selected", () => {
    const { steps } = stepsOf(manifest({ uiRoots: ["src/**/web"] }));
    expect(steps.every((s) => s.why.trim().length > 0)).toBe(true);
    expect(steps.find((s) => s.id === "ui")?.why).toContain("src/**/web");
  });
});

describe("kumiko check", () => {
  test("runs every resolved suite once, with no flags passed through", async () => {
    const h = harness({ repoManifest: manifest({ uiRoots: ["src/**/web"] }) });
    const code = await runCheck({ argv: [], cwd: h.cwd, out: h.out }, h.deps);
    expect(code).toBe(0);
    expect(h.calls.schema).toEqual([["validate"]]);
    expect(h.calls.schemaCwd).toEqual([h.repoDir]);
    expect(h.calls.guards).toEqual([[]]);
    expect(h.calls.ui).toEqual([[]]);
    expect(h.calls.checks).toEqual([[]]);
  });

  test('kind "app" without uiRoots exits 1 with a hint before any step runs, also with --explain', async () => {
    for (const argv of [[], ["--explain"]]) {
      const h = harness({ repoManifest: manifest({ uiRoots: undefined }) });
      const code = await runCheck({ argv, cwd: h.cwd, out: h.out }, h.deps);
      expect(code).toBe(1);
      expect(h.errs.join("\n")).toContain("uiRoots");
      expect(h.calls.guards).toEqual([]);
      expect(h.calls.checks).toEqual([]);
      expect(h.calls.schema).toEqual([]);
    }
  });

  test("a derived manifest without uiRoots names kumiko.json in the hint", async () => {
    const h = harness({
      repoManifest: manifest({ uiRoots: undefined }),
      manifestSource: "derived",
    });
    expect(await runCheck({ argv: [], cwd: h.cwd, out: h.out }, h.deps)).toBe(1);
    expect(h.errs.join("\n")).toContain("Add a kumiko.json");
  });

  test("uiRoots: [] prints the waiver line, normally and with --explain, and runs no ui step", async () => {
    for (const argv of [[], ["--explain"]]) {
      const h = harness({ repoManifest: manifest({ uiRoots: [] }) });
      expect(await runCheck({ argv, cwd: h.cwd, out: h.out }, h.deps)).toBe(0);
      expect(h.logs.join("\n")).toContain("UI guards skipped on purpose");
      expect(h.calls.ui).toEqual([]);
    }
  });

  test("non-empty uiRoots runs the ui step", async () => {
    const h = harness({ repoManifest: manifest({ uiRoots: ["src/app"] }) });
    expect(await runCheck({ argv: [], cwd: h.cwd, out: h.out }, h.deps)).toBe(0);
    expect(h.calls.ui).toEqual([[]]);
  });

  test("a failing suite fails the command", async () => {
    const h = harness({ exitCodes: { checks: 3 } });
    expect(await runCheck({ argv: [], cwd: h.cwd, out: h.out }, h.deps)).toBe(1);
  });

  test("a failing boot validation fails the command and still runs the guards", async () => {
    const h = harness({ exitCodes: { schema: 1 } });
    expect(await runCheck({ argv: [], cwd: h.cwd, out: h.out }, h.deps)).toBe(1);
    expect(h.calls.guards).toEqual([[]]);
  });

  test("a throwing boot step counts as a failure and the remaining suites still run", async () => {
    const h = harness({ schemaLoadError: new Error("schema import exploded") });
    expect(await runCheck({ argv: [], cwd: h.cwd, out: h.out }, h.deps)).toBe(1);
    expect(h.errs.join("\n")).toContain("schema import exploded");
    expect(h.calls.guards).toEqual([[]]);
    expect(h.calls.checks).toEqual([[]]);
  });

  test("--explain propagates a failing guards explain exit code", async () => {
    const h = harness({ exitCodes: { guards: 2 } });
    expect(await runCheck({ argv: ["--explain"], cwd: h.cwd, out: h.out }, h.deps)).toBe(2);
  });

  test("--explain prints the step list, scans nothing but the guards' own explain", async () => {
    const h = harness({ repoManifest: manifest({ uiRoots: ["src/**/web"] }) });
    const code = await runCheck({ argv: ["--explain"], cwd: h.cwd, out: h.out }, h.deps);
    expect(code).toBe(0);
    expect(h.calls.guards).toEqual([["--explain"]]);
    expect(h.calls.ui).toEqual([]);
    expect(h.calls.checks).toEqual([]);
    expect(h.calls.schema).toEqual([]);
    const printed = h.logs.join("\n");
    for (const id of ["boot", "guards", "ui", "checks"]) expect(printed).toContain(id);
  });

  test("a missing guards package fails loud with an install hint — never a silent skip", async () => {
    const h = harness({ guardsLoadError: new Error("Cannot find module") });
    const code = await runCheck({ argv: [], cwd: h.cwd, out: h.out }, h.deps);
    expect(code).toBe(1);
    const printed = h.errs.join("\n");
    expect(printed).toContain("@cosmicdrift/kumiko-guards");
    expect(printed).toContain("bun add -d @cosmicdrift/kumiko-guards");
    expect(h.calls.schema).toEqual([]);
  });

  test("an unknown flag fails instead of being ignored", async () => {
    const h = harness();
    const code = await runCheck({ argv: ["-explain"], cwd: h.cwd, out: h.out }, h.deps);
    expect(code).toBe(1);
    expect(h.errs.join("\n")).toContain("-explain");
    expect(h.calls.guards).toEqual([]);
  });

  test('a kind "app" repo without kumiko/schema.ts runs the guards but not boot', async () => {
    const h = harness({ appSchemaMissing: true });
    const code = await runCheck({ argv: [], cwd: h.cwd, out: h.out }, h.deps);
    expect(code).toBe(0);
    expect(h.calls.schema).toEqual([]);
    expect(h.calls.guards).toEqual([[]]);
    expect(h.calls.checks).toEqual([[]]);
  });

  test("a repo without a manifest is an error, not an empty green run", async () => {
    const h = harness({ repoMissing: true });
    const code = await runCheck({ argv: [], cwd: h.cwd, out: h.out }, h.deps);
    expect(code).toBe(1);
    expect(h.errs.join("\n")).toContain("kumiko.json");
  });

  test('kind "tooling" is green and says so, running no suite', async () => {
    const h = harness({ repoManifest: manifest({ kind: "tooling" }) });
    const code = await runCheck({ argv: [], cwd: h.cwd, out: h.out }, h.deps);
    expect(code).toBe(0);
    expect(h.logs.join("\n")).toContain("Nothing to check");
    expect(h.calls.guards).toEqual([]);
  });

  test("a cwd other than the process cwd is refused — the guards scan the ambient cwd", async () => {
    const h = harness();
    const code = await runCheck({ argv: [], cwd: "/tmp", out: h.out }, h.deps);
    expect(code).toBe(1);
    expect(h.calls.guards).toEqual([]);
  });
});
