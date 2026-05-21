import { afterEach, describe, expect, test } from "vitest";
import { makeContext, makeSpyOutput, makeTempCwd } from "../_test-helpers";
import { cleanTestDbsCommand } from "../clean-test-dbs";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups) c();
  cleanups.length = 0;
});

describe("clean-test-dbs command", () => {
  test("registered + maintainer-only", () => {
    expect(cleanTestDbsCommand.id).toBe("clean-test-dbs");
    expect(cleanTestDbsCommand.roles).toEqual(["maintainer"]);
  });

  test("missing scripts/cleanup-test-dbs.ts emits error", async () => {
    const t = makeTempCwd();
    cleanups.push(t.cleanup);
    const spy = makeSpyOutput();
    const exit = await cleanTestDbsCommand.run(
      makeContext({ cwd: t.cwd, repoRoot: t.cwd, out: spy.out }),
    );
    expect(exit).toBe(1);
    expect(spy.errs.join("\n")).toMatch(/cleanup-test-dbs\.ts not found/);
  });
});
