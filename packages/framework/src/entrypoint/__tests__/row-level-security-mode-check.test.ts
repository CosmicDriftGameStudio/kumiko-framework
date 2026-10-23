import { describe, expect, test } from "bun:test";
import { createDbConnection } from "../../db/connection.ts";
import type { RowLevelSecurityMode } from "../../db/index.ts";
import type { AppContext } from "../../engine/types/index.ts";
import { assertEntrypointRowLevelSecurityMode } from "../row-level-security-mode-check.ts";

// Pools connect lazily, so a never-used connection is enough to carry the mode.
function contextWithPoolMode(mode: RowLevelSecurityMode): AppContext {
  const { db } = createDbConnection({
    url: "postgres://unused:unused@127.0.0.1:1/unused",
    rowLevelSecurity: mode,
  });
  return { db };
}

describe("assertEntrypointRowLevelSecurityMode", () => {
  test("passes when the declared mode equals the pool mode", () => {
    expect(() =>
      assertEntrypointRowLevelSecurityMode(contextWithPoolMode("on"), "on"),
    ).not.toThrow();
    expect(() =>
      assertEntrypointRowLevelSecurityMode(contextWithPoolMode("off"), "off"),
    ).not.toThrow();
  });

  test("an undeclared mode means off", () => {
    expect(() =>
      assertEntrypointRowLevelSecurityMode(contextWithPoolMode("off"), undefined),
    ).not.toThrow();
    expect(() =>
      assertEntrypointRowLevelSecurityMode(contextWithPoolMode("on"), undefined),
    ).toThrow(/rowLevelSecurity is "off" but the database connection runs in "on" mode/);
  });

  test("declared on over an off pool throws, naming both modes", () => {
    expect(() => assertEntrypointRowLevelSecurityMode(contextWithPoolMode("off"), "on")).toThrow(
      /rowLevelSecurity is "on" but the database connection runs in "off" mode/,
    );
  });

  test("a context without a database has nothing to compare", () => {
    expect(() => assertEntrypointRowLevelSecurityMode({}, "on")).not.toThrow();
  });
});
