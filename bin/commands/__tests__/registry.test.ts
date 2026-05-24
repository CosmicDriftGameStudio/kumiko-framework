import { afterEach, describe, expect, test } from "bun:test";
import { _resetRegistry, defineCommand, getCommand, getCommands } from "../registry";
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

describe("commands/registry", () => {
  afterEach(() => _resetRegistry());

  test("defineCommand returns the registered command", () => {
    const cmd = defineCommand(fake("foo", ["maintainer"]));
    expect(cmd.id).toBe("foo");
    expect(getCommand("foo")).toBe(cmd);
  });

  test("duplicate ids throw", () => {
    defineCommand(fake("dup", ["maintainer"]));
    expect(() => defineCommand(fake("dup", ["app-dev"]))).toThrow(/already registered/);
  });

  test("getCommands filters by role", () => {
    defineCommand(fake("only-maintainer", ["maintainer"]));
    defineCommand(fake("only-app-dev", ["app-dev"]));
    defineCommand(fake("both", ["maintainer", "app-dev"]));

    const m = getCommands("maintainer").map((c) => c.id).sort();
    const a = getCommands("app-dev").map((c) => c.id).sort();
    expect(m).toEqual(["both", "only-maintainer"]);
    expect(a).toEqual(["both", "only-app-dev"]);
  });

  test("getCommands returns registration-order, not alphabetical", () => {
    defineCommand(fake("z-first", ["maintainer"]));
    defineCommand(fake("a-second", ["maintainer"]));
    expect(getCommands("maintainer").map((c) => c.id)).toEqual(["z-first", "a-second"]);
  });

  test("unknown id returns undefined", () => {
    expect(getCommand("does-not-exist")).toBeUndefined();
  });
});
