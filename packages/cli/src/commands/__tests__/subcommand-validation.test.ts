import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../../index";

const UNREACHABLE_DATABASE_URL = "postgres://nobody:nobody@127.0.0.1:1/none";

let appDir: string;
let previousDatabaseUrl: string | undefined;

function capture(): {
  out: { log: (s: string) => void; err: (s: string) => void };
  lines: string[];
} {
  const lines: string[] = [];
  return { lines, out: { log: (s) => lines.push(s), err: (s) => lines.push(s) } };
}

beforeEach(() => {
  appDir = mkdtempSync(join(tmpdir(), "kumiko-cli-subcommand-"));
  writeFileSync(join(appDir, "kumiko.config.ts"), "export default { features: [] };\n");
  previousDatabaseUrl = process.env["DATABASE_URL"];
});

afterEach(() => {
  if (previousDatabaseUrl === undefined) delete process.env["DATABASE_URL"];
  else process.env["DATABASE_URL"] = previousDatabaseUrl;
  rmSync(appDir, { recursive: true, force: true });
});

describe.each(["project", "consumer"])("kumiko %s", (command) => {
  test("unknown subcommand prints usage before touching config or database", async () => {
    delete process.env["DATABASE_URL"];
    const { out, lines } = capture();
    const code = await runCli({ argv: [command, "bogus"], cwd: appDir, out });
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain(`Usage: kumiko ${command}`);
    expect(lines.join("\n")).not.toContain("DATABASE_URL");
  });

  test("missing subcommand prints usage", async () => {
    delete process.env["DATABASE_URL"];
    const { out, lines } = capture();
    const code = await runCli({ argv: [command], cwd: appDir, out });
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain(`Usage: kumiko ${command}`);
  });

  test("unreachable database yields an error message and exit 1 instead of a rejection", async () => {
    process.env["DATABASE_URL"] = UNREACHABLE_DATABASE_URL;
    const { out, lines } = capture();
    const code = await runCli({ argv: [command, "list"], cwd: appDir, out });
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("✗");
  });
});
