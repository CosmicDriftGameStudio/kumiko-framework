import { describe, expect, test } from "bun:test";
import { runUpgradeCli } from "@cosmicdrift/kumiko-framework/upgrade-cli";
import { upgradeCommand } from "../upgrade";

describe("kumiko upgrade help", () => {
  test("documents every flag the real CLI usage lists", async () => {
    const logged: string[] = [];
    const code = await runUpgradeCli(["--help"], process.cwd(), {
      log: (line) => logged.push(line),
      err: (line) => logged.push(line),
    });
    expect(code).toBe(0);
    const realFlags = new Set(logged.join("\n").match(/--[a-z][a-z-]*/g) ?? []);
    expect(realFlags.size).toBeGreaterThan(0);
    for (const flag of realFlags) {
      expect(upgradeCommand.help).toContain(flag);
    }
  });
});
