// runTailwindOnce runs Tailwind in-process; its output must stay byte-identical to the
// `@tailwindcss/cli` it replaced. The CLI spawn lives only here, as the reference.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runTailwindOnce } from "../build-prod-bundle.js";
import { resolveTailwindCli } from "../resolve-tailwind-cli.js";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "../../../..");
const RENDERER_WEB_STYLES = resolve(here, "../../../renderer-web/src/styles.css");

async function runTailwindCli(entry: string, cwd: string): Promise<string> {
  const cliPath = resolveTailwindCli({ bun: Bun, cwd });
  if (cliPath === undefined) throw new Error("@tailwindcss/cli not resolvable");
  const outDir = await mkdtemp(join(REPO_ROOT, ".tw-parity-out-"));
  try {
    const outPath = join(outDir, "styles.css");
    const proc = Bun.spawn(
      [process.argv[0] ?? "bun", "run", cliPath, "-i", entry, "-o", outPath, "--minify"],
      {
        cwd,
        stdout: "ignore",
        stderr: "inherit",
      },
    );
    expect(await proc.exited).toBe(0);
    return await readFile(outPath, "utf8");
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}

describe("runTailwindOnce parity with the Tailwind CLI", () => {
  const dirs: string[] = [];
  afterAll(async () => {
    for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  });

  test("trivial fixture: byte-identical output", async () => {
    const dir = await mkdtemp(join(REPO_ROOT, ".tw-parity-"));
    dirs.push(dir);
    await writeFile(join(dir, "input.css"), '@import "tailwindcss";\n');
    await writeFile(
      join(dir, "page.html"),
      '<div class="flex p-4 text-red-500 hover:underline"></div>',
    );
    const entry = join(dir, "input.css");
    const inProcess = await runTailwindOnce(entry, dir);
    expect(inProcess).toContain("text-red-500");
    expect(inProcess).toBe(await runTailwindCli(entry, dir));
  });

  test("renderer-web styles.css: byte-identical output", async () => {
    const inProcess = await runTailwindOnce(RENDERER_WEB_STYLES, REPO_ROOT);
    expect(inProcess.length).toBeGreaterThan(10_000);
    expect(inProcess).toBe(await runTailwindCli(RENDERER_WEB_STYLES, REPO_ROOT));
  });

  test("a missing stylesheet rejects", async () => {
    const dir = await mkdtemp(join(REPO_ROOT, ".tw-parity-"));
    dirs.push(dir);
    await expect(runTailwindOnce(join(dir, "missing.css"), dir)).rejects.toThrow();
  });
});
