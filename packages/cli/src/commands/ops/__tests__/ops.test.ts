import { describe, expect, test } from "bun:test";
import { opsCommand } from "../index";

function run(argv: readonly string[]) {
  const errs: string[] = [];
  const result = opsCommand.run({
    argv,
    cwd: process.cwd(),
    out: { log: () => {}, err: (line) => errs.push(line) },
  });
  return { result, errs };
}

describe("kumiko ops", () => {
  test("an unknown subcommand prints the usage and exits 1", async () => {
    const { result, errs } = run(["nope"]);
    expect(await result).toBe(1);
    expect(errs.join("\n")).toContain("backfill-pii");
  });
});
