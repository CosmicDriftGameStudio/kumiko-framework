import { describe, expect, test } from "bun:test";
import { createCommandRegistry } from "../registry";
import type { Command } from "../types";

const noop: Command["run"] = async () => 0;

function fake(id: string, roles: Command["roles"]): Command {
  return {
    id,
    label: id,
    description: id,
    help: "",
    category: "quality",
    roles,
    run: noop,
  };
}

// Each test builds its own isolated registry via createCommandRegistry() — never
// the process-wide default. Mutating the shared default here would race the
// bin/-command coverage tests that read it under the concurrent runner.
describe("commands/registry", () => {
  test("defineCommand returns the registered command", () => {
    const { defineCommand, getCommand } = createCommandRegistry();
    const cmd = defineCommand(fake("foo", ["maintainer"]));
    expect(cmd.id).toBe("foo");
    expect(getCommand("foo")).toBe(cmd);
  });

  test("duplicate ids throw", () => {
    const { defineCommand } = createCommandRegistry();
    defineCommand(fake("dup", ["maintainer"]));
    expect(() => defineCommand(fake("dup", ["app-dev"]))).toThrow(/already registered/);
  });

  test("getCommands filters by role", () => {
    const { defineCommand, getCommands } = createCommandRegistry();
    defineCommand(fake("only-maintainer", ["maintainer"]));
    defineCommand(fake("only-app-dev", ["app-dev"]));
    defineCommand(fake("both", ["maintainer", "app-dev"]));

    const m = getCommands("maintainer")
      .map((c) => c.id)
      .sort();
    const a = getCommands("app-dev")
      .map((c) => c.id)
      .sort();
    expect(m).toEqual(["both", "only-maintainer"]);
    expect(a).toEqual(["both", "only-app-dev"]);
  });

  test("getCommands returns registration-order, not alphabetical", () => {
    const { defineCommand, getCommands } = createCommandRegistry();
    defineCommand(fake("z-first", ["maintainer"]));
    defineCommand(fake("a-second", ["maintainer"]));
    expect(getCommands("maintainer").map((c) => c.id)).toEqual(["z-first", "a-second"]);
  });

  test("unknown id returns undefined", () => {
    const { getCommand } = createCommandRegistry();
    expect(getCommand("does-not-exist")).toBeUndefined();
  });
});
