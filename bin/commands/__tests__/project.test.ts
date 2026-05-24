import { afterEach, describe, expect, test } from "bun:test";
import { makeContext, makeSpyOutput, makeTempCwd } from "../_test-helpers";
import { projectCommand } from "../project";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups) c();
  cleanups.length = 0;
});

describe("project command", () => {
  test("registered + both roles", () => {
    expect(projectCommand.id).toBe("project");
    expect(projectCommand.roles).toContain("maintainer");
    expect(projectCommand.roles).toContain("app-dev");
  });

  test("missing kumiko.config.ts emits helpful error", async () => {
    const t = makeTempCwd();
    cleanups.push(t.cleanup);
    const spy = makeSpyOutput();
    const exit = await projectCommand.run(
      makeContext({ cwd: t.cwd, argv: ["list"], out: spy.out }),
    );
    expect(exit).toBe(1);
    expect(spy.errs.join("\n")).toMatch(/kumiko\.config\.ts not found/);
  });
});
