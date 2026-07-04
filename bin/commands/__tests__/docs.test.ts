import { describe, expect, test } from "bun:test";
import { cliCommandDocUrl, cliIndexUrl } from "../../docs-urls";
import "../index";
import { docsCommand } from "../docs";

const outLines: string[] = [];
const out = {
  log: (msg: string) => outLines.push(msg),
  warn: (msg: string) => outLines.push(msg),
  err: (msg: string) => outLines.push(msg),
};

describe("docs command", () => {
  test("prints CLI index URL by default", async () => {
    outLines.length = 0;
    const code = await docsCommand.run({
      argv: ["--print"],
      cwd: process.cwd(),
      role: "app-dev",
      binPath: "",
      repoRoot: "",
      scope: undefined,
      out,
    });
    expect(code).toBe(0);
    expect(outLines).toContain(cliIndexUrl());
  });

  test("prints per-command doc URL with /en/cli/commands/ path", async () => {
    outLines.length = 0;
    const code = await docsCommand.run({
      argv: ["schema", "--print"],
      cwd: process.cwd(),
      role: "app-dev",
      binPath: "",
      repoRoot: "",
      scope: undefined,
      out,
    });
    expect(code).toBe(0);
    expect(outLines).toContain(cliCommandDocUrl("schema"));
  });

  test("rejects unknown command", async () => {
    outLines.length = 0;
    const code = await docsCommand.run({
      argv: ["not-a-command", "--print"],
      cwd: process.cwd(),
      role: "app-dev",
      binPath: "",
      repoRoot: "",
      scope: undefined,
      out,
    });
    expect(code).toBe(1);
    expect(outLines.join("\n")).toContain("Unknown command");
  });
});

