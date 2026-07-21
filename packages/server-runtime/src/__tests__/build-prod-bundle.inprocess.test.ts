// In-process buildProdBundle — covers Bun.build + HTML render + build-info
// in the same process (CLI subprocess tests do not contribute to lcov).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildProdBundle } from "../build-prod-bundle";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../../..");

describe("buildProdBundle in-process (Bun.build)", () => {
  let tmp = "";

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "kumiko-build-inproc-"));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  async function writeMinimalClientApp(opts?: { html?: string; client?: string }) {
    await mkdir(join(tmp, "src"), { recursive: true });
    await writeFile(
      join(tmp, "src/client.ts"),
      opts?.client ??
        `const root = document.getElementById("root"); if (root) root.textContent = "hi";`,
    );
    await mkdir(join(tmp, "public"), { recursive: true });
    await writeFile(
      join(tmp, "public/index.html"),
      opts?.html ??
        `<!doctype html><html><head></head><body><div id="root"></div><script type="module" src="/client.js"></script></body></html>`,
    );
    await writeFile(join(tmp, "package.json"), `{"name":"inproc-fixture","private":true}`);
  }

  test("client.ts → hashed bundle, manifest, build-info, injected script", async () => {
    await writeMinimalClientApp();

    const result = await buildProdBundle({ cwd: tmp, stylesheet: false });

    expect(result.manifest["client.js"]).toMatch(/^\/assets\/client-[a-z0-9]+\.js$/);
    expect(result.buildInfo?.id).toMatch(/^[0-9a-f]{12}$/);
    expect(existsSync(join(tmp, "dist/build-info.json"))).toBe(true);

    const html = await readFile(join(tmp, "dist/index.html"), "utf8");
    expect(html).toContain(`src="${result.manifest["client.js"]}"`);
    expect(html).toContain("__KUMIKO_BUILD__");

    const assetPath = join(tmp, "dist", result.manifest["client.js"] ?? "");
    expect(existsSync(assetPath)).toBe(true);
    expect(await readFile(assetPath, "utf8")).toContain('"hi"');
  });

  test("missing index.html → error with template snippet", async () => {
    await mkdir(join(tmp, "src"), { recursive: true });
    await writeFile(join(tmp, "src/client.ts"), `console.log("hi");`);
    await writeFile(join(tmp, "package.json"), `{"name":"no-html","private":true}`);

    await expect(buildProdBundle({ cwd: tmp, stylesheet: false })).rejects.toThrow(
      /kein index\.html gefunden/,
    );
  });

  test("index.html without /client.js placeholder → error with snippet", async () => {
    await writeMinimalClientApp({
      html: `<!doctype html><html><body>no script</body></html>`,
    });

    await expect(buildProdBundle({ cwd: tmp, stylesheet: false })).rejects.toThrow(
      /keinen Entry-Tag für \/client\.js/,
    );
  });

  test("syntax-broken client → Bun.build rejects", async () => {
    await writeMinimalClientApp({ client: `const x = {{{` });

    // Bun may throw "Bundle failed" before returning `{ success: false }`.
    await expect(buildProdBundle({ cwd: tmp, stylesheet: false })).rejects.toThrow(
      /Bundle failed|Bun\.build failed/,
    );
  });

  test("stylesheet override src/styles.css → hashed styles.css in manifest", async () => {
    // Temp under REPO_ROOT so @tailwindcss/cli + tailwindcss peer resolve
    // (same constraint as renderer-web-css-relocation.integration.test.ts).
    const dir = await mkdtemp(join(REPO_ROOT, ".inproc-styles-"));
    const cwd = join(dir, "app");
    try {
      await mkdir(join(cwd, "src"), { recursive: true });
      await writeFile(
        join(cwd, "src/client.ts"),
        `const root = document.getElementById("root"); if (root) root.textContent = "hi";`,
      );
      await writeFile(join(cwd, "src/styles.css"), "body { margin: 0; }\n");
      await mkdir(join(cwd, "public"), { recursive: true });
      await writeFile(
        join(cwd, "public/index.html"),
        `<!doctype html><html><head><link rel="stylesheet" href="/styles.css" /></head><body><div id="root"></div><script type="module" src="/client.js"></script></body></html>`,
      );
      await writeFile(join(cwd, "package.json"), `{"name":"inproc-styles","private":true}`);

      const result = await buildProdBundle({ cwd, stylesheet: "src/styles.css" });

      expect(result.manifest["styles.css"]).toMatch(/^\/assets\/styles-[a-z0-9]+\.css$/);
      const cssPath = join(cwd, "dist", result.manifest["styles.css"] ?? "");
      expect(existsSync(cssPath)).toBe(true);
      expect(await readFile(cssPath, "utf8")).toMatch(/margin:\s*0/);

      const html = await readFile(join(cwd, "dist/index.html"), "utf8");
      expect(html).toContain(`href="${result.manifest["styles.css"]}"`);
      expect(html).not.toContain('href="/styles.css"');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("missing stylesheet override → tailwind rejects", async () => {
    const dir = await mkdtemp(join(REPO_ROOT, ".inproc-styles-miss-"));
    const cwd = join(dir, "app");
    try {
      await mkdir(join(cwd, "src"), { recursive: true });
      await writeFile(join(cwd, "src/client.ts"), `console.log("hi");`);
      await mkdir(join(cwd, "public"), { recursive: true });
      await writeFile(
        join(cwd, "public/index.html"),
        `<!doctype html><html><body><div id="root"></div><script type="module" src="/client.js"></script></body></html>`,
      );
      await writeFile(join(cwd, "package.json"), `{"name":"inproc-styles-miss","private":true}`);

      await expect(buildProdBundle({ cwd, stylesheet: "src/missing-theme.css" })).rejects.toThrow(
        /tailwind|Bundle failed|tailwindcss/i,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("multi-entry client-admin + client-public → two hashed bundles", async () => {
    await mkdir(join(tmp, "src"), { recursive: true });
    await writeFile(join(tmp, "src/client-admin.ts"), `console.log("admin");`);
    await writeFile(join(tmp, "src/client-public.ts"), `console.log("public");`);
    await mkdir(join(tmp, "public"), { recursive: true });
    await writeFile(
      join(tmp, "public/index.html"),
      `<!doctype html><html><body><script type="module" src="/client-public.js"></script></body></html>`,
    );
    await writeFile(
      join(tmp, "admin.html"),
      `<!doctype html><html><body><script type="module" src="/client-admin.js"></script></body></html>`,
    );
    await writeFile(join(tmp, "package.json"), `{"name":"multi-inproc","private":true}`);

    const result = await buildProdBundle({ cwd: tmp, stylesheet: false });

    expect(result.manifest["client-admin.js"]).toMatch(/^\/assets\/client-admin-/);
    expect(result.manifest["client-public.js"]).toMatch(/^\/assets\/client-public-/);
    expect(existsSync(join(tmp, "dist/admin.html"))).toBe(true);
    expect(existsSync(join(tmp, "dist/index.html"))).toBe(true);
  });
});
