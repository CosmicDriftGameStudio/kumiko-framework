import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../../index";

let workDir: string;
let logs: string[];
let errors: string[];

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "handbuch-cli-"));
  logs = [];
  errors = [];
});
afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

const out = () => ({
  log: (line: string) => logs.push(line),
  err: (line: string) => errors.push(line),
});

function write(relativePath: string, content: string): string {
  const target = join(workDir, relativePath);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, content);
  return target;
}

describe("kumiko handbuch build", () => {
  test("builds index.html from a config relative to --root", async () => {
    write(
      "handbuch.json",
      JSON.stringify({
        title: "CLI Handbuch",
        repo: "app",
        locales: ["de"],
        defaultLocale: "de",
        groups: [{ id: "eins", label: "Eins" }],
        textsDir: "handbuch/{locale}",
        screens: [{ id: "alpha", title: "Alpha", group: "eins" }],
      }),
    );
    write("app/handbuch/de/alpha.md", "---\ntitel: Alpha\nscreenId: alpha\n---\n\nHallo Welt");
    const outDir = join(workDir, "site");

    const code = await runCli({
      argv: ["handbuch", "build", "handbuch.json", "--root", workDir, "--out", outDir],
      out: out(),
    });

    expect(code).toBe(0);
    expect(readFileSync(join(outDir, "index.html"), "utf8")).toContain("Hallo Welt");
    expect(logs.join("\n")).toContain("CLI Handbuch: 1 Kapitel");
  });

  test("a missing config is a usage error", async () => {
    const code = await runCli({ argv: ["handbuch", "build"], out: out() });

    expect(code).toBe(2);
    expect(errors.join("\n")).toContain("Usage: kumiko handbuch build");
  });

  test("an invalid config reports the offending field and exits 2", async () => {
    write("bad.json", JSON.stringify({ title: "x" }));
    const outDir = join(workDir, "site");

    const code = await runCli({
      argv: ["handbuch", "build", "bad.json", "--root", workDir, "--out", outDir],
      out: out(),
    });

    expect(code).toBe(2);
    expect(errors.join("\n")).toContain("repo");
    expect(existsSync(outDir)).toBe(false);
  });
});
