import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT_PATH = join(
  import.meta.dir,
  "../scripts/codemod/unprocessable-error-details-reason.ts",
);

function makeFixtureDir(files: Record<string, string>): {
  readonly dir: string;
  readonly cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "unprocessable-error-codemod-"));
  for (const [relPath, content] of Object.entries(files)) {
    const full = join(dir, relPath);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content, "utf-8");
  }
  return {
    dir,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore — best-effort
      }
    },
  };
}

async function runCodemod(targetDir: string, extraArgs: readonly string[] = []): Promise<string> {
  const proc = Bun.spawn({
    cmd: ["bun", SCRIPT_PATH, targetDir, ...extraArgs],
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  return `${stdout}${stderr}`;
}

function read(dir: string, relPath: string): string {
  return readFileSync(join(dir, relPath), "utf-8");
}

describe("unprocessable-error-details-reason codemod", () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  test("removes reason from the middle of a details object literal", async () => {
    const fixture = makeFixtureDir({
      "guard.ts": `import { UnprocessableError } from "@cosmicdrift/kumiko-framework/errors";

export function guard(spec: { field: string; code: string }, current: number, limit: number) {
  throw new UnprocessableError(spec.code, {
    i18nKey: "errors.cap",
    details: { field: spec.field, reason: spec.code, current, limit },
  });
}
`,
    });
    cleanup = fixture.cleanup;

    await runCodemod(fixture.dir);

    const out = read(fixture.dir, "guard.ts");
    expect(out).toContain("details: { field: spec.field, current, limit }");
    expect(out).not.toContain("reason: spec.code");
  });

  test("removes reason from the start of a details object literal", async () => {
    const fixture = makeFixtureDir({
      "guard.ts": `import { UnprocessableError } from "@cosmicdrift/kumiko-framework/errors";

export function guard(error: { reason: string; actual: number; max: number }) {
  throw new UnprocessableError("cap", {
    details: { reason: error.reason, actual: error.actual, max: error.max },
  });
}
`,
    });
    cleanup = fixture.cleanup;

    await runCodemod(fixture.dir);

    const out = read(fixture.dir, "guard.ts");
    expect(out).toContain("details: { actual: error.actual, max: error.max }");
    expect(out).not.toContain("reason: error.reason");
  });

  test("removes reason when it is the only property, leaving a valid empty object literal", async () => {
    const fixture = makeFixtureDir({
      "guard.ts": `import { UnprocessableError } from "@cosmicdrift/kumiko-framework/errors";

export function guard() {
  throw new UnprocessableError("apex", {
    details: { reason: "no_tenant_context_on_apex" },
  });
}
`,
    });
    cleanup = fixture.cleanup;

    await runCodemod(fixture.dir);

    const out = read(fixture.dir, "guard.ts");
    expect(out).not.toContain("reason:");
    expect(out).toMatch(/details:\s*\{\s*\}/);

    // The result must still be syntactically valid TypeScript — TS2307
    // (module not found) is expected and irrelevant here: there is no real
    // node_modules in an in-memory project. Anything else is a real error.
    const { Project } = await import("ts-morph");
    const project = new Project({ skipAddingFilesFromTsConfig: true, useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile("guard.ts", out);
    const diagnostics = sourceFile.getPreEmitDiagnostics().filter((d) => d.getCode() !== 2307);
    expect(diagnostics.length).toBe(0);
  });

  test("follows a renamed import (UnprocessableError as X)", async () => {
    const fixture = makeFixtureDir({
      "guard.ts": `import { UnprocessableError as MyError } from "@cosmicdrift/kumiko-framework/errors";

export function guard() {
  throw new MyError("x", { details: { reason: "y", other: 1 } });
}
`,
    });
    cleanup = fixture.cleanup;

    const output = await runCodemod(fixture.dir);

    const out = read(fixture.dir, "guard.ts");
    expect(out).toContain("details: { other: 1 }");
    expect(out).not.toContain("reason:");
    expect(output).toContain("removed 1 redundant");
  });

  test("does not touch a locally defined class with the same name", async () => {
    const fixture = makeFixtureDir({
      "guard.ts": `class UnprocessableError extends Error {}

export function guard() {
  throw new UnprocessableError("local", { details: { reason: "y" } } as never);
}
`,
    });
    cleanup = fixture.cleanup;

    const before = read(fixture.dir, "guard.ts");
    const output = await runCodemod(fixture.dir);
    const after = read(fixture.dir, "guard.ts");

    expect(after).toBe(before);
    expect(output).toContain("locally defined class");
  });

  test("skips a details object literal containing a spread", async () => {
    const fixture = makeFixtureDir({
      "guard.ts": `import { UnprocessableError } from "@cosmicdrift/kumiko-framework/errors";

export function guard(rest: Record<string, unknown>) {
  throw new UnprocessableError("x", { details: { ...rest, reason: "y" } });
}
`,
    });
    cleanup = fixture.cleanup;

    const before = read(fixture.dir, "guard.ts");
    const output = await runCodemod(fixture.dir);
    const after = read(fixture.dir, "guard.ts");

    expect(after).toBe(before);
    expect(output).toContain("spread");
  });

  test("--dry-run writes nothing", async () => {
    const fixture = makeFixtureDir({
      "guard.ts": `import { UnprocessableError } from "@cosmicdrift/kumiko-framework/errors";

export function guard() {
  throw new UnprocessableError("x", { details: { reason: "y", other: 1 } });
}
`,
    });
    cleanup = fixture.cleanup;

    const before = read(fixture.dir, "guard.ts");
    const output = await runCodemod(fixture.dir, ["--dry-run"]);
    const after = read(fixture.dir, "guard.ts");

    expect(after).toBe(before);
    expect(output).toContain("dry-run");
    expect(output).toContain("removed 1 redundant");
  });
});
