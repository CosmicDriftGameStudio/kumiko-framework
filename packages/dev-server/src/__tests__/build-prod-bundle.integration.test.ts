// Integration-Tests für buildProdBundle — End-to-End-Pfad gegen das
// echte Filesystem.
//
// Zwei Szenarien:
//
//   1. Vanilla-Pipeline (kein client.tsx, nur public/ + html-template):
//      läuft unter Node-Vitest direkt — kein Bun.build, keine
//      Subprocess-Akrobatik. Beweist Discovery + html-rendering +
//      public-copy + manifest-format.
//
//   2. Volle Pipeline (client.tsx + Bun.build + Hash + Manifest):
//      braucht Bun. Spawnen kumiko-build als subprocess via PATH.
//      Skipped wenn `bun` nicht erreichbar — selten, aber sauber.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildProdBundle } from "@cosmicdrift/kumiko-server-runtime/build-prod-bundle";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const KUMIKO_BUILD_BIN = resolve(__dirname, "../../bin/kumiko-build.ts");

// Each of these tests spawns kumiko-build (real Bun.build + tailwind, ~1s). The
// spawn is synchronous, so the test timeout only fires after the child exits:
// BUILD_PROCESS_TIMEOUT_MS is what actually kills a hung build.
const BUILD_PROCESS_TIMEOUT_MS = 6_000;

function bunAvailable(): boolean {
  try {
    execFileSync("bun", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("buildProdBundle (vanilla pipeline)", () => {
  let tmp = "";

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "kumiko-build-it-"));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  test("kopiert public/ 1:1 nach dist/", async () => {
    await mkdir(join(tmp, "public"), { recursive: true });
    await writeFile(join(tmp, "public/favicon.txt"), "fav-content");
    await writeFile(join(tmp, "public/robots.txt"), "User-agent: *\nDisallow:\n");
    await writeFile(
      join(tmp, "public/index.html"),
      `<!doctype html><html><body>Hello</body></html>`,
    );

    const result = await buildProdBundle({ cwd: tmp });

    expect(result.manifest).toEqual({});
    expect(await readFile(join(tmp, "dist/favicon.txt"), "utf8")).toBe("fav-content");
    expect(await readFile(join(tmp, "dist/robots.txt"), "utf8")).toContain("User-agent");
  });

  test("rendert public/index.html als Template (Inhalt erhalten)", async () => {
    await mkdir(join(tmp, "public"), { recursive: true });
    await writeFile(
      join(tmp, "public/index.html"),
      `<!doctype html><html><head><title>Custom Title</title></head><body>Custom Body</body></html>`,
    );

    await buildProdBundle({ cwd: tmp });

    const html = await readFile(join(tmp, "dist/index.html"), "utf8");
    expect(html).toContain("Custom Title");
    expect(html).toContain("Custom Body");
  });

  test("schreibt manifest.json auch wenn leer", async () => {
    await mkdir(join(tmp, "public"), { recursive: true });
    await writeFile(join(tmp, "public/index.html"), `<html></html>`);

    await buildProdBundle({ cwd: tmp });

    const manifest = JSON.parse(await readFile(join(tmp, "dist/manifest.json"), "utf8"));
    expect(manifest).toEqual({});
  });

  test("public/index.html landet NICHT als rohes File in dist/ (wird als Template behandelt)", async () => {
    await mkdir(join(tmp, "public"), { recursive: true });
    const original = `<!doctype html><html><body>SOURCE</body></html>`;
    await writeFile(join(tmp, "public/index.html"), original);
    await writeFile(join(tmp, "public/other.txt"), "ABC");

    await buildProdBundle({ cwd: tmp });

    // dist/index.html existiert (gerendert), public/other.txt wurde kopiert
    expect(existsSync(join(tmp, "dist/index.html"))).toBe(true);
    expect(existsSync(join(tmp, "dist/other.txt"))).toBe(true);
    // Inhalt: was im Template stand, kommt im Output an (kein Doppel-Pfad
    // wo public/index.html und dist/index.html sich gegenseitig überschreiben).
    expect(await readFile(join(tmp, "dist/index.html"), "utf8")).toContain("SOURCE");
  });

  test("clean wipe: vorhandenes dist/-Junk wird entfernt", async () => {
    await mkdir(join(tmp, "public"), { recursive: true });
    await writeFile(join(tmp, "public/index.html"), `<html></html>`);
    // Junk-File aus altem Build
    await mkdir(join(tmp, "dist/old"), { recursive: true });
    await writeFile(join(tmp, "dist/old/stale.js"), "old content");

    await buildProdBundle({ cwd: tmp });

    expect(existsSync(join(tmp, "dist/old/stale.js"))).toBe(false);
  });

  test("wirft mit klarer Message wenn weder public/ noch index.html noch client da", async () => {
    // tmp ist leer
    await expect(buildProdBundle({ cwd: tmp })).rejects.toThrow(/nothing to build/);
  });

  test("wirft mit Anweisung wenn HTML-Template ohne /client.js Placeholder vorliegt", async () => {
    // Simuliert: User hat bereits manifest-entry (faken über option, in
    // realer Pipeline kommt's aus Bun.build). Wir testen renderHtml /
    // injectAssetTags-Verhalten via lower-level Pfad: HTML ohne Tag,
    // public-folder simuliert dass Build was zu tun hat. Erwartete
    // Error-Message zitiert das exakte Snippet.
    //
    // Dieser Pfad wird im realen Build durch buildClientBundle ausgelöst
    // und im Vanilla-Test können wir ihn nicht direkt triggern (kein
    // Bun.build). Der CLI-Subprocess-Test deckt das ab.
    await mkdir(join(tmp, "public"), { recursive: true });
    await writeFile(
      join(tmp, "public/index.html"),
      `<!doctype html><html><body>no script tag here</body></html>`,
    );
    // Ohne client.tsx läuft Bun.build nicht, manifest bleibt {} →
    // injectAssetTags wirft NICHT. Das ist gewollt: wenn nichts zu
    // injizieren da ist, ist's auch kein Fehler.
    const result = await buildProdBundle({ cwd: tmp });
    expect(result.manifest).toEqual({});
  });
});

// Voller Pipeline-Test gegen das echte CLI-bin via subprocess. Bringt
// echtes Bun.build + Tailwind ins Spiel — der Pfad den die anderen
// Tests bewusst nicht laufen können (Vitest unter Node).
describe.skipIf(!bunAvailable())("kumiko-build CLI (full pipeline with bun)", () => {
  let tmp = "";

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "kumiko-build-cli-"));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  test("client.ts → hashed bundle, manifest, html mit injected script-tag", async () => {
    // A client without external deps leaves Bun.build nothing to resolve.
    await mkdir(join(tmp, "src"), { recursive: true });
    await writeFile(
      join(tmp, "src/client.ts"),
      `const root = document.getElementById("root"); if (root) root.textContent = "hi";`,
    );
    await mkdir(join(tmp, "public"), { recursive: true });
    await writeFile(
      join(tmp, "public/index.html"),
      `<!doctype html><html><head></head><body><div id="root"></div><script type="module" src="/client.js"></script></body></html>`,
    );
    // Acts like stylesheet:false: no src/styles.css and outside the monorepo,
    // so the renderer-web fallback fails and resolves to undefined.
    await writeFile(join(tmp, "package.json"), `{"name":"build-it-fixture","private":true}`);

    execFileSync("bun", [KUMIKO_BUILD_BIN, tmp], {
      stdio: "pipe",
      timeout: BUILD_PROCESS_TIMEOUT_MS,
    });

    const manifest = JSON.parse(await readFile(join(tmp, "dist/manifest.json"), "utf8")) as Record<
      string,
      string
    >;
    expect(manifest["client.js"]).toMatch(/^\/assets\/client-[a-z0-9]+\.js$/);

    const html = await readFile(join(tmp, "dist/index.html"), "utf8");
    expect(html).toContain(`src="${manifest["client.js"]}"`);
    expect(html).toContain('id="root"');

    const assetPath = join(tmp, "dist", manifest["client.js"] ?? "");
    expect(existsSync(assetPath)).toBe(true);

    // Minification mangles identifiers, so only the "hi" literal proves the user code is in.
    expect(await readFile(assetPath, "utf8")).toContain('"hi"');
  });

  test("client.ts ohne index.html → klarer Error mit Template-Vorschlag", async () => {
    await mkdir(join(tmp, "src"), { recursive: true });
    await writeFile(join(tmp, "src/client.ts"), `console.log("hi");`);
    await writeFile(join(tmp, "package.json"), `{"name":"no-html","private":true}`);

    let stderr = "";
    expect(() => {
      try {
        execFileSync("bun", [KUMIKO_BUILD_BIN, tmp], {
          stdio: "pipe",
          timeout: BUILD_PROCESS_TIMEOUT_MS,
        });
      } catch (err) {
        const e = err as { stderr?: Buffer };
        stderr = e.stderr?.toString() ?? "";
        throw err;
      }
    }).toThrow();

    expect(stderr).toContain("kein index.html gefunden");
    expect(stderr).toContain(`<script type="module" src="/client.js"></script>`);
  });

  test("client.ts + index.html ohne /client.js Placeholder → klarer Error", async () => {
    await mkdir(join(tmp, "src"), { recursive: true });
    await writeFile(join(tmp, "src/client.ts"), `console.log("hi");`);
    await mkdir(join(tmp, "public"), { recursive: true });
    await writeFile(
      join(tmp, "public/index.html"),
      `<!doctype html><html><body>no script</body></html>`,
    );
    await writeFile(join(tmp, "package.json"), `{"name":"no-placeholder","private":true}`);

    let stderr = "";
    expect(() => {
      try {
        execFileSync("bun", [KUMIKO_BUILD_BIN, tmp], {
          stdio: "pipe",
          timeout: BUILD_PROCESS_TIMEOUT_MS,
        });
      } catch (err) {
        const e = err as { stderr?: Buffer };
        stderr = e.stderr?.toString() ?? "";
        throw err;
      }
    }).toThrow();

    expect(stderr).toContain("keinen Entry-Tag für /client.js");
    expect(stderr).toContain(`<script type="module" src="/client.js"></script>`);
  });

  function runKumikoBuild(cwd: string): { status: number | null; stdout: string; stderr: string } {
    const result = spawnSync("bun", [KUMIKO_BUILD_BIN, cwd], {
      encoding: "utf8",
      timeout: BUILD_PROCESS_TIMEOUT_MS,
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  test("src/client-admin.tsx without a kumiko.clientEntries declaration → exit 1 with the declaration snippet on stderr", async () => {
    await mkdir(join(tmp, "src"), { recursive: true });
    await writeFile(join(tmp, "src/client-admin.tsx"), `console.log("admin");`);
    await writeFile(join(tmp, "package.json"), `{"name":"legacy-entry","private":true}`);

    const result = runKumikoBuild(tmp);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("✗");
    expect(result.stderr).toContain('"kumiko.clientEntries"');
    expect(result.stderr).toContain(`{ "name": "admin", "sourceFile": "./src/client-admin.tsx" }`);
    expect(existsSync(join(tmp, "dist"))).toBe(false);
  });

  test("clientEntry and clientEntries together → exit 1 through the shared error path", async () => {
    await mkdir(join(tmp, "src"), { recursive: true });
    await writeFile(join(tmp, "src/main.ts"), `console.log("x");`);
    await writeFile(
      join(tmp, "package.json"),
      JSON.stringify({
        name: "both-declared",
        private: true,
        kumiko: {
          clientEntry: "./src/main.ts",
          clientEntries: [{ name: "main", sourceFile: "./src/main.ts" }],
        },
      }),
    );

    const result = runKumikoBuild(tmp);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("mutually exclusive");
  });

  test("a valid kumiko.clientEntries declaration builds both bundles", async () => {
    await mkdir(join(tmp, "src"), { recursive: true });
    await mkdir(join(tmp, "public"), { recursive: true });
    await writeFile(join(tmp, "src/client-admin.ts"), `console.log("admin-bundle");`);
    await writeFile(join(tmp, "src/client-public.ts"), `console.log("public-bundle");`);
    await writeFile(
      join(tmp, "public/admin.html"),
      `<!doctype html><html><body><script type="module" src="/client-admin.js"></script></body></html>`,
    );
    await writeFile(
      join(tmp, "public/index.html"),
      `<!doctype html><html><body><script type="module" src="/client-public.js"></script></body></html>`,
    );
    await writeFile(
      join(tmp, "package.json"),
      JSON.stringify({
        name: "multi-entry",
        private: true,
        kumiko: {
          clientEntries: [
            { name: "admin", sourceFile: "./src/client-admin.ts" },
            { name: "public", sourceFile: "./src/client-public.ts" },
          ],
        },
      }),
    );

    const result = runKumikoBuild(tmp);

    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
    const manifest = JSON.parse(await readFile(join(tmp, "dist/manifest.json"), "utf8")) as Record<
      string,
      string
    >;
    expect(manifest["client-admin.js"]).toMatch(/^\/assets\/client-admin-[a-z0-9]+\.js$/);
    expect(manifest["client-public.js"]).toMatch(/^\/assets\/client-public-[a-z0-9]+\.js$/);
    expect(await readFile(join(tmp, "dist", manifest["client-admin.js"] ?? ""), "utf8")).toContain(
      "admin-bundle",
    );
    expect(await readFile(join(tmp, "dist", manifest["client-public.js"] ?? ""), "utf8")).toContain(
      "public-bundle",
    );
  });

  test("Re-Build mit unverändertem Source produziert identischen Hash (reproducibility)", async () => {
    await mkdir(join(tmp, "src"), { recursive: true });
    await writeFile(join(tmp, "src/client.ts"), `console.log("stable");`);
    await mkdir(join(tmp, "public"), { recursive: true });
    await writeFile(
      join(tmp, "public/index.html"),
      `<!doctype html><html><body><script type="module" src="/client.js"></script></body></html>`,
    );
    await writeFile(join(tmp, "package.json"), `{"name":"hash-stability","private":true}`);

    execFileSync("bun", [KUMIKO_BUILD_BIN, tmp], {
      stdio: "pipe",
      timeout: BUILD_PROCESS_TIMEOUT_MS,
    });
    const manifest1 = JSON.parse(await readFile(join(tmp, "dist/manifest.json"), "utf8")) as Record<
      string,
      string
    >;

    execFileSync("bun", [KUMIKO_BUILD_BIN, tmp], {
      stdio: "pipe",
      timeout: BUILD_PROCESS_TIMEOUT_MS,
    });
    const manifest2 = JSON.parse(await readFile(join(tmp, "dist/manifest.json"), "utf8")) as Record<
      string,
      string
    >;

    expect(manifest2["client.js"]).toBe(manifest1["client.js"]);
  });
});
