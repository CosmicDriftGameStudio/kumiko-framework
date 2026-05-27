import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServerBundle } from "../build-server-bundle";

// Baut ein Mini-App-Fixture (bin/main.ts + bin/kumiko.ts teilen ein Modul) und
// prüft das Variante-B-Verhalten: ein Bun.build-Call → server.js + kumiko.js als
// Entries + geteilter chunk statt zwei vollen Bundles.
function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "server-bundle-"));
  mkdirSync(join(dir, "bin"));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "package.json"), `${JSON.stringify({ name: "fixture-app" })}\n`);
  writeFileSync(join(dir, "src/shared.ts"), "export function shared(): number { return 42; }\n");
  // main.ts → wird zu server.js umbenannt; kumiko.ts macht findRepoRoot zum
  // repoRoot dieses Fixtures, also wird kumiko.js gebaut.
  writeFileSync(
    join(dir, "bin/main.ts"),
    `import { shared } from "../src/shared";\nconsole.log("server", shared());\n`,
  );
  writeFileSync(
    join(dir, "bin/kumiko.ts"),
    `import { shared } from "../src/shared";\nconsole.log("migrate", shared());\n`,
  );
  return dir;
}

describe("buildServerBundle (multi-entry + splitting)", () => {
  test("produces server.js + kumiko.js as entries + a shared chunk", async () => {
    const dir = makeFixture();
    try {
      const result = await buildServerBundle({ cwd: dir, outDir: join(dir, "dist-server") });
      const outDir = result.outDir;

      // main.ts wurde zu server.js umbenannt.
      expect(existsSync(join(outDir, "server.js"))).toBe(true);
      expect(existsSync(join(outDir, "main.js"))).toBe(false);
      expect(existsSync(join(outDir, "kumiko.js"))).toBe(true);

      const entryFiles = result.entries.map((e) => e.file).sort();
      expect(entryFiles).toEqual(["kumiko.js", "server.js"]);

      // Das geteilte Modul liegt in einem chunk, nicht in beiden Entries inlined.
      expect(result.chunks.length).toBeGreaterThanOrEqual(1);
      const serverSrc = readFileSync(join(outDir, "server.js"), "utf8");
      expect(serverSrc).toContain("chunk-");

      // Kein Legacy-Drizzle-Output mehr.
      expect(existsSync(join(outDir, "migration-hooks.js"))).toBe(false);
      expect(existsSync(join(outDir, "drizzle.config.ts"))).toBe(false);

      // Runtime-package.json mit start-Script, ohne drizzle-deps.
      const pkg = JSON.parse(readFileSync(join(outDir, "package.json"), "utf8"));
      expect(pkg.scripts.start).toBe("bun run server.js");
      expect(Object.keys(pkg.dependencies)).not.toContain("drizzle-kit");
      expect(Object.keys(pkg.dependencies)).not.toContain("drizzle-orm");

      expect(result.totalBytes).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
