import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { makeContext, makeSpyOutput, makeTempCwd } from "../_test-helpers";
import { initDeployCommand } from "../init-deploy";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups) c();
  cleanups.length = 0;
});

function tmp(): string {
  const t = makeTempCwd();
  cleanups.push(t.cleanup);
  return t.cwd;
}

describe("init-deploy command", () => {
  test("defined with correct metadata", () => {
    expect(initDeployCommand.id).toBe("init-deploy");
    expect(initDeployCommand.help).toContain("--check");
  });

  test("delegates to runInitDeployCli: scaffolds deploy/ files", async () => {
    const cwd = tmp();
    const spy = makeSpyOutput();
    const exit = await initDeployCommand.run(
      makeContext({ cwd, argv: ["--app", "my-app"], out: spy.out }),
    );
    expect(exit).toBe(0);
    expect(existsSync(join(cwd, "deploy", "Dockerfile"))).toBe(true);
  });

  test("delegates --check: exit 1 with no writes when deploy/ is missing", async () => {
    const cwd = tmp();
    const spy = makeSpyOutput();
    const exit = await initDeployCommand.run(
      makeContext({ cwd, argv: ["--app", "my-app", "--check"], out: spy.out }),
    );
    expect(exit).toBe(1);
    expect(existsSync(join(cwd, "deploy"))).toBe(false);
  });
});
