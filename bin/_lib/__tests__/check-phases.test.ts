import { describe, expect, test } from "bun:test";
import { parseCheckPhases } from "../check-phases";

describe("parseCheckPhases", () => {
  test("without --phase every phase runs, so a plain `kumiko check` is unchanged", () => {
    expect([...parseCheckPhases([])].sort()).toEqual(["static", "tests"]);
    expect([...parseCheckPhases(["--verbose"])].sort()).toEqual(["static", "tests"]);
  });

  test("selects a single phase", () => {
    expect([...parseCheckPhases(["--phase=static"])]).toEqual(["static"]);
    expect([...parseCheckPhases(["--phase=tests"])]).toEqual(["tests"]);
  });

  test("a repeated flag selects the union", () => {
    expect([...parseCheckPhases(["--phase=static", "--phase=tests"])].sort()).toEqual([
      "static",
      "tests",
    ]);
  });

  test("an unknown phase fails instead of silently running nothing", () => {
    expect(() => parseCheckPhases(["--phase=unit"])).toThrow(/Unknown check phase\(s\): unit/);
    expect(() => parseCheckPhases(["--phase="])).toThrow(/Unknown check phase/);
  });
});
