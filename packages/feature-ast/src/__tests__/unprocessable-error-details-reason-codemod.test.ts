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

  test("follows a namespace import (errors.UnprocessableError)", async () => {
    const fixture = makeFixtureDir({
      "guard.ts": `import * as errors from "@cosmicdrift/kumiko-framework/errors";

export function guard() {
  throw new errors.UnprocessableError("x", { details: { reason: "y", other: 1 } });
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

  test("reports a member-access callee it cannot resolve instead of skipping silently", async () => {
    const fixture = makeFixtureDir({
      "guard.ts": `import * as errors from "some-other-lib";

export function guard() {
  throw new errors.UnprocessableError("x", { details: { reason: "y" } });
}
`,
    });
    cleanup = fixture.cleanup;

    const output = await runCodemod(fixture.dir);

    expect(read(fixture.dir, "guard.ts")).toContain('reason: "y"');
    expect(output).toContain("guard.ts:4");
    expect(output).toContain("errors.UnprocessableError");
  });

  test("removes a string-literal reason key", async () => {
    const fixture = makeFixtureDir({
      "guard.ts": `import { UnprocessableError } from "@cosmicdrift/kumiko-framework/errors";

export function guard() {
  throw new UnprocessableError("x", { details: { "reason": "y", other: 1 } });
}
`,
    });
    cleanup = fixture.cleanup;

    await runCodemod(fixture.dir);

    const out = read(fixture.dir, "guard.ts");
    expect(out).toContain("details: { other: 1 }");
    expect(out).not.toContain("reason");
  });

  test("removes a shorthand reason when the variable is still used positionally", async () => {
    const fixture = makeFixtureDir({
      "guard.ts": `import { UnprocessableError } from "@cosmicdrift/kumiko-framework/errors";

export function guard(reason: string) {
  throw new UnprocessableError(reason, { details: { reason, other: 1 } });
}
`,
    });
    cleanup = fixture.cleanup;

    await runCodemod(fixture.dir);

    const out = read(fixture.dir, "guard.ts");
    expect(out).toContain("new UnprocessableError(reason, { details: { other: 1 } })");
  });

  test("skips a shorthand reason whose variable is only used in details", async () => {
    const fixture = makeFixtureDir({
      "guard.ts": `import { UnprocessableError } from "@cosmicdrift/kumiko-framework/errors";

export function guard() {
  const reason = "y";
  throw new UnprocessableError("x", { details: { reason, other: 1 } });
}
`,
    });
    cleanup = fixture.cleanup;

    const before = read(fixture.dir, "guard.ts");
    const output = await runCodemod(fixture.dir);

    expect(read(fixture.dir, "guard.ts")).toBe(before);
    expect(output).toContain("would leave the bound variable unused");
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

  test("does not report a details literal with a spread but no reason key", async () => {
    const fixture = makeFixtureDir({
      "guard.ts": `import { UnprocessableError } from "@cosmicdrift/kumiko-framework/errors";

export function guard(rest: Record<string, unknown>) {
  throw new UnprocessableError("x", { details: { ...rest, field: "y" } });
}
`,
    });
    cleanup = fixture.cleanup;

    const before = read(fixture.dir, "guard.ts");
    const output = await runCodemod(fixture.dir);

    expect(read(fixture.dir, "guard.ts")).toBe(before);
    expect(output).toContain("Skipped 0 site(s)");
    expect(output).toContain("Unverified 0 site(s)");
  });

  test("lists a non-analyzable details argument as unverified, apart from manual skips", async () => {
    const fixture = makeFixtureDir({
      "guard.ts": `import { failUnprocessable } from "@cosmicdrift/kumiko-framework/errors";

export function guard(details: Record<string, unknown>) {
  return failUnprocessable("x", details);
}
`,
    });
    cleanup = fixture.cleanup;

    const output = await runCodemod(fixture.dir);

    expect(output).toContain("Skipped 0 site(s)");
    expect(output).toContain("Unverified 1 site(s)");
  });

  test("removes reason from the details literal of failUnprocessable(reason, details)", async () => {
    const fixture = makeFixtureDir({
      "guard.ts": `import { failUnprocessable } from "@cosmicdrift/kumiko-framework/errors";

export function guard() {
  return failUnprocessable("x", { reason: "y", other: 1 });
}
`,
    });
    cleanup = fixture.cleanup;

    await runCodemod(fixture.dir);

    const out = read(fixture.dir, "guard.ts");
    expect(out).toContain('failUnprocessable("x", { other: 1 })');
    expect(out).not.toContain('reason: "y"');
  });

  test("skips a failUnprocessable details literal with a spread and reports it", async () => {
    const fixture = makeFixtureDir({
      "guard.ts": `import { failUnprocessable } from "@cosmicdrift/kumiko-framework/errors";

export function guard(base: Record<string, unknown>) {
  return failUnprocessable("x", { ...base, reason: "y" });
}
`,
    });
    cleanup = fixture.cleanup;

    const before = read(fixture.dir, "guard.ts");
    const output = await runCodemod(fixture.dir);

    expect(read(fixture.dir, "guard.ts")).toBe(before);
    expect(output).toContain("spread");
  });

  test("skips a non-literal failUnprocessable details argument and reports it", async () => {
    const fixture = makeFixtureDir({
      "guard.ts": `import { failUnprocessable } from "@cosmicdrift/kumiko-framework/errors";

export function guard(details: Record<string, unknown>) {
  return failUnprocessable("x", details);
}
`,
    });
    cleanup = fixture.cleanup;

    const before = read(fixture.dir, "guard.ts");
    const output = await runCodemod(fixture.dir);

    expect(read(fixture.dir, "guard.ts")).toBe(before);
    expect(output).toContain("not a statically-analyzable object literal");
  });

  test("leaves a locally defined failUnprocessable alone but reports the skip", async () => {
    const fixture = makeFixtureDir({
      "guard.ts": `function failUnprocessable(reason: string, details?: object) {
  return { reason, details };
}

export const result = failUnprocessable("x", { reason: "y" });
`,
    });
    cleanup = fixture.cleanup;

    const before = read(fixture.dir, "guard.ts");
    const output = await runCodemod(fixture.dir);

    expect(read(fixture.dir, "guard.ts")).toBe(before);
    expect(output).toContain("locally defined function");
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
