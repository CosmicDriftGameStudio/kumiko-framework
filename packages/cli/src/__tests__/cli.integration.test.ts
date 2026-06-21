// Drives runCli in-process — captures stdout/stderr via the injected
// Output, exercises the 3-command-walkthrough end-to-end (new app +
// add feature) into a tmp directory.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../index";

type Captured = { logs: string[]; errs: string[] };

function capture(): {
  out: { log: (s: string) => void; err: (s: string) => void };
  captured: Captured;
} {
  const captured: Captured = { logs: [], errs: [] };
  return {
    captured,
    out: {
      log: (s) => captured.logs.push(s),
      err: (s) => captured.errs.push(s),
    },
  };
}

describe("kumiko cli", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "kumiko-cli-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("--help prints commands + docs link", async () => {
    const { out, captured } = capture();
    const code = await runCli({ argv: ["--help"], out });
    expect(code).toBe(0);
    const joined = captured.logs.join("\n");
    expect(joined).toContain("kumiko new app");
    expect(joined).toContain("kumiko add feature");
    expect(joined).toContain("docs.kumiko.rocks");
  });

  test("no args prints help", async () => {
    const { out, captured } = capture();
    const code = await runCli({ argv: [], out });
    expect(code).toBe(0);
    expect(captured.logs.join("\n")).toContain("kumiko new app");
  });

  test("--version prints semver", async () => {
    const { out, captured } = capture();
    const code = await runCli({ argv: ["--version"], out });
    expect(code).toBe(0);
    expect(captured.logs[0]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("unknown command exits 1", async () => {
    const { out, captured } = capture();
    const code = await runCli({ argv: ["bogus"], out });
    expect(code).toBe(1);
    expect(captured.errs.join("\n")).toContain("unknown command");
  });

  test("new app <name> scaffolds the walkthrough files", async () => {
    const { out, captured } = capture();
    const code = await runCli({ argv: ["new", "app", "my-notes"], cwd: tmp, out });
    expect(code).toBe(0);
    const appRoot = join(tmp, "my-notes");
    for (const f of [
      "package.json",
      "tsconfig.json",
      "src/run-config.ts",
      "bin/main.ts",
      "bin/dev.ts",
      ".env.example",
      "README.md",
    ]) {
      expect(() => readFileSync(join(appRoot, f), "utf-8")).not.toThrow();
    }
    expect(captured.logs.join("\n")).toContain("Scaffolded my-notes");
  });

  test("new app rejects bad name", async () => {
    const { out, captured } = capture();
    const code = await runCli({ argv: ["new", "app", "My Notes"], cwd: tmp, out });
    expect(code).toBe(1);
    expect(captured.errs.join("\n")).toContain("kebab-case");
  });

  test("new app without name exits 1 with usage hint", async () => {
    const { out, captured } = capture();
    const code = await runCli({ argv: ["new", "app"], cwd: tmp, out });
    expect(code).toBe(1);
    expect(captured.errs.join("\n")).toContain("missing <name>");
  });

  test("add feature mounts into scaffolded app", async () => {
    const { out: out1 } = capture();
    await runCli({ argv: ["new", "app", "my-notes"], cwd: tmp, out: out1 });
    const appRoot = join(tmp, "my-notes");

    const { out: out2, captured } = capture();
    const code = await runCli({ argv: ["add", "feature", "notes"], cwd: appRoot, out: out2 });
    expect(code).toBe(0);

    const runConfig = readFileSync(join(appRoot, "src/run-config.ts"), "utf-8");
    expect(runConfig).toContain(`import { notesFeature } from "./features/notes";`);
    expect(runConfig).toContain("notesFeature");
    expect(captured.logs.join("\n")).toContain("auto-mounted");
  });

  test("add feature without name exits 1", async () => {
    const { out, captured } = capture();
    const code = await runCli({ argv: ["add", "feature"], cwd: tmp, out });
    expect(code).toBe(1);
    expect(captured.errs.join("\n")).toContain("missing <name>");
  });
});
