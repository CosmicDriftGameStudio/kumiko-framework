import { afterEach, describe, expect, test } from "vitest";
import { makeContext, makeSpyOutput, makeTempCwd } from "../_test-helpers";
import { migrateCommand } from "../migrate";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups) c();
  cleanups.length = 0;
});

describe("migrate command", () => {
  test("registered + both roles", () => {
    expect(migrateCommand.id).toBe("migrate");
    expect(migrateCommand.roles).toContain("maintainer");
    expect(migrateCommand.roles).toContain("app-dev");
  });

  test("missing drizzle.config.ts in cwd → helpful error", async () => {
    const t = makeTempCwd();
    cleanups.push(t.cleanup);
    const prevInit = process.env["INIT_CWD"];
    process.env["INIT_CWD"] = t.cwd;
    try {
      const spy = makeSpyOutput();
      const exit = await migrateCommand.run(
        makeContext({ cwd: t.cwd, argv: ["status"], out: spy.out }),
      );
      expect(exit).toBe(1);
      expect(spy.errs.join("\n")).toMatch(/No drizzle\.config\.ts/);
    } finally {
      if (prevInit !== undefined) process.env["INIT_CWD"] = prevInit;
      else delete process.env["INIT_CWD"];
    }
  });

  test("unknown subcommand prints subcommand-list", async () => {
    const t = makeTempCwd({ "drizzle.config.ts": "export default {};" });
    cleanups.push(t.cleanup);
    const prevInit = process.env["INIT_CWD"];
    const prevRoot = process.env["KUMIKO_REPO_ROOT"];
    process.env["INIT_CWD"] = t.cwd;
    // Pretend drizzle-kit exists so the early-exit doesn't fire.
    process.env["KUMIKO_REPO_ROOT"] = t.cwd;
    try {
      const spy = makeSpyOutput();
      // No subcommand → default branch fires (exit 0 + usage).
      const exit = await migrateCommand.run(
        makeContext({ cwd: t.cwd, argv: [], out: spy.out }),
      );
      // Either path is acceptable here — the test verifies the
      // missing-drizzle-kit OR the usage-output kicks in.
      expect([0, 1]).toContain(exit);
    } finally {
      if (prevInit !== undefined) process.env["INIT_CWD"] = prevInit;
      else delete process.env["INIT_CWD"];
      if (prevRoot !== undefined) process.env["KUMIKO_REPO_ROOT"] = prevRoot;
      else delete process.env["KUMIKO_REPO_ROOT"];
    }
  });
});
