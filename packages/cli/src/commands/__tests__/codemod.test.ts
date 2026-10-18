import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../../index";

let appDir: string;

function capture(): {
  out: { log: (s: string) => void; err: (s: string) => void };
  lines: string[];
} {
  const lines: string[] = [];
  return { lines, out: { log: (s) => lines.push(s), err: (s) => lines.push(s) } };
}

beforeEach(() => {
  appDir = mkdtempSync(join(tmpdir(), "kumiko-cli-codemod-"));
  mkdirSyncSrc(appDir);
});

afterEach(() => {
  rmSync(appDir, { recursive: true, force: true });
});

function mkdirSyncSrc(dir: string): void {
  writeFileSync(join(dir, "dep.ts"), "export const dep = 1;\n");
  writeFileSync(join(dir, "main.ts"), 'import { dep } from "./dep.js";\nconsole.log(dep);\n');
}

describe("kumiko codemod", () => {
  test("without a name it lists the codemods", async () => {
    const { out, lines } = capture();
    const code = await runCli({ argv: ["codemod"], cwd: appDir, out });
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("import-extensions");
  });

  test("an unknown name fails and lists the codemods", async () => {
    const { out, lines } = capture();
    const code = await runCli({ argv: ["codemod", "bogus"], cwd: appDir, out });
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain('unknown codemod "bogus"');
    expect(lines.join("\n")).toContain("import-extensions");
  });

  test("previews by default and rewrites with --write", async () => {
    const preview = capture();
    expect(
      await runCli({ argv: ["codemod", "import-extensions"], cwd: appDir, out: preview.out }),
    ).toBe(0);
    expect(preview.lines.join("\n")).toContain("rewritable: 1 site(s)");
    expect(readFileSync(join(appDir, "main.ts"), "utf8")).toContain('"./dep.js"');

    const write = capture();
    expect(
      await runCli({
        argv: ["codemod", "import-extensions", "--write", "--no-format"],
        cwd: appDir,
        out: write.out,
      }),
    ).toBe(0);
    expect(readFileSync(join(appDir, "main.ts"), "utf8")).toContain('"./dep.ts"');
  });
});
