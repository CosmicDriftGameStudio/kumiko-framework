import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInitDeployCli } from "../init-deploy-cli";

function makeOut() {
  const logs: string[] = [];
  const errs: string[] = [];
  return {
    out: { log: (m: string) => logs.push(m), err: (m: string) => errs.push(m) },
    logs,
    errs,
  };
}

describe("runInitDeployCli", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "kumiko-init-deploy-cli-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("scaffolds with an explicit --app and reports exit 0", async () => {
    const { out, logs } = makeOut();
    const code = await runInitDeployCli({ argv: ["--app", "myapp"], cwd: tmp, out });
    expect(code).toBe(0);
    expect(logs.some((l) => l.includes("Deploy scaffolding generated"))).toBe(true);
  });

  it("defaults --app from package.json name, stripping the scope", async () => {
    writeFileSync(join(tmp, "package.json"), JSON.stringify({ name: "@cosmicdrift/some-app" }));
    const { out, logs } = makeOut();
    const code = await runInitDeployCli({ argv: [], cwd: tmp, out });
    expect(code).toBe(0);
    expect(logs.some((l) => l.includes("some-app"))).toBe(true);
  });

  it("fails with a usage error when --app is missing and package.json has no name", async () => {
    const { out, errs } = makeOut();
    const code = await runInitDeployCli({ argv: [], cwd: tmp, out });
    expect(code).toBe(1);
    expect(errs.some((e) => e.includes("--app <name> is required"))).toBe(true);
  });

  it("--check and --force are mutually exclusive (exit 2)", async () => {
    const { out, errs } = makeOut();
    const code = await runInitDeployCli({
      argv: ["--app", "myapp", "--check", "--force"],
      cwd: tmp,
      out,
    });
    expect(code).toBe(2);
    expect(errs.some((e) => e.includes("mutually exclusive"))).toBe(true);
  });

  it("--check exits 0 when deploy/ is already in sync", async () => {
    const first = await runInitDeployCli({
      argv: ["--app", "myapp"],
      cwd: tmp,
      out: makeOut().out,
    });
    expect(first).toBe(0);
    const { out, logs } = makeOut();
    const code = await runInitDeployCli({ argv: ["--app", "myapp", "--check"], cwd: tmp, out });
    expect(code).toBe(0);
    expect(logs.some((l) => l.includes("in sync"))).toBe(true);
  });

  it("--check exits 1 and lists drifted files when deploy/ is missing or stale", async () => {
    const { out: outMissing, errs: errsMissing } = makeOut();
    const missingCode = await runInitDeployCli({
      argv: ["--app", "myapp", "--check"],
      cwd: tmp,
      out: outMissing,
    });
    expect(missingCode).toBe(1);
    expect(errsMissing.some((e) => e.includes("missing"))).toBe(true);

    await runInitDeployCli({ argv: ["--app", "myapp"], cwd: tmp, out: makeOut().out });
    writeFileSync(join(tmp, "deploy", "Dockerfile"), "# stale");
    const { out: outStale, errs: errsStale } = makeOut();
    const staleCode = await runInitDeployCli({
      argv: ["--app", "myapp", "--check"],
      cwd: tmp,
      out: outStale,
    });
    expect(staleCode).toBe(1);
    expect(errsStale.some((e) => e.includes("differs"))).toBe(true);
    expect(errsStale.some((e) => e.includes("--force to regenerate"))).toBe(true);
  });

  it("rejects a non-kebab appName via the underlying scaffold validation", async () => {
    const { out, errs } = makeOut();
    const code = await runInitDeployCli({ argv: ["--app", "MyApp"], cwd: tmp, out });
    expect(code).toBe(1);
    expect(errs.some((e) => e.includes("kebab-case"))).toBe(true);
  });
});
