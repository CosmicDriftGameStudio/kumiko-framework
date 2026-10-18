import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { opsCommand } from "../index";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function run(argv: readonly string[], cwd = process.cwd()) {
  const errs: string[] = [];
  const result = opsCommand.run({
    argv,
    cwd,
    out: { log: () => {}, err: (line) => errs.push(line) },
  });
  return { result, errs };
}

describe("kumiko ops", () => {
  test("an unknown subcommand prints the usage and exits 1", async () => {
    const { result, errs } = run(["nope"]);
    expect(await result).toBe(1);
    expect(errs.join("\n")).toContain("waitlist-migrate");
  });

  test("waitlist-migrate without a valid --from exits 1 with its usage", async () => {
    const { result, errs } = run(["waitlist-migrate", "--from", "mailchimp"]);
    expect(await result).toBe(1);
    expect(errs.join("\n")).toContain("--from <offlot|publicstatus>");
  });

  test("waitlist-migrate without a kumiko.config.ts exits 1", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kumiko-ops-"));
    tmpDirs.push(dir);
    const { result, errs } = run(["waitlist-migrate", "--from", "offlot"], dir);
    expect(await result).toBe(1);
    expect(errs.join("\n")).toContain("kumiko.config.ts not found");
  });

  test("waitlist-migrate refuses an app that does not mount the waitlist feature", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kumiko-ops-"));
    tmpDirs.push(dir);
    writeFileSync(join(dir, "kumiko.config.ts"), "export default { features: [] };\n");
    const previous = process.env["DATABASE_URL"];
    process.env["DATABASE_URL"] = "postgres://unused.invalid/none";
    try {
      const { result, errs } = run(["waitlist-migrate", "--from", "offlot"], dir);
      expect(await result).toBe(1);
      expect(errs.join("\n")).toContain("does not mount the framework `waitlist` feature");
    } finally {
      if (previous === undefined) delete process.env["DATABASE_URL"];
      else process.env["DATABASE_URL"] = previous;
    }
  });
});
