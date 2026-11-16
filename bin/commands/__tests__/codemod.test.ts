import { afterEach, describe, expect, test } from "bun:test";
import { makeContext, makeSpyOutput, makeTempCwd } from "../_test-helpers";
import { codemodPipelineCommand } from "../codemod";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups) c();
  cleanups.length = 0;
});

describe("codemod command", () => {
  test("registered + maintainer-only", () => {
    expect(codemodPipelineCommand.id).toBe("codemod:pipeline");
    expect(codemodPipelineCommand.roles).toEqual(["maintainer"]);
  });

  test("--dry-run on an empty directory converts nothing and exits 0", async () => {
    const t = makeTempCwd();
    cleanups.push(t.cleanup);
    const spy = makeSpyOutput();
    const exit = await codemodPipelineCommand.run(
      makeContext({ cwd: t.cwd, argv: ["--dry-run", "--dir", t.cwd], out: spy.out }),
    );
    expect(exit).toBe(0);
    expect(spy.logs.join("\n")).toContain("DRY RUN");
  });
});
