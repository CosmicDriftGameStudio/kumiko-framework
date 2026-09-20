import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const COUNT_PLAYWRIGHT_MODULES = `
await import(process.argv[1]);
const loaded = Object.keys(require.cache);
console.log(JSON.stringify({ total: loaded.length, playwright: loaded.filter((path) => path.includes("playwright")).length }));
`;

function loadedModules(entry: string): { total: number; playwright: number } {
  const result = Bun.spawnSync(
    ["bun", "-e", COUNT_PLAYWRIGHT_MODULES, resolve(import.meta.dir, entry)],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (result.exitCode !== 0) throw new Error(`loading ${entry} failed: ${result.stderr}`);
  return JSON.parse(String(result.stdout).trim().split("\n").pop() ?? "");
}

describe("server-side entries stay free of Playwright", () => {
  test("the seed-route entry loads no Playwright module", () => {
    const { total, playwright } = loadedModules("../e2e/seed-route.ts");

    expect(total).toBeGreaterThan(100);
    expect(playwright).toBe(0);
  });

  test("the framework-facing barrel loads no Playwright module", () => {
    expect(loadedModules("../index.ts").playwright).toBe(0);
  });

  test("control: the Playwright-side barrel does load Playwright", () => {
    expect(loadedModules("../e2e/index.ts").playwright).toBeGreaterThan(0);
  });
});
