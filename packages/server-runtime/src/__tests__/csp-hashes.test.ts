import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProdBundle } from "../build-prod-bundle.js";
import {
  CSP_HASHES_FILE,
  collectBuildScriptHashes,
  inlineScriptHashes,
  readCspHashes,
  resolveCspScriptHashes,
} from "../csp-hashes.js";
import { withSecurityHeaders } from "../security-headers.js";

const sha256Of = (content: string): string =>
  `sha256-${createHash("sha256").update(content, "utf8").digest("base64")}`;

describe("inlineScriptHashes", () => {
  test("hashes the exact inline content, skips src scripts and data blocks", () => {
    const inline = "document.documentElement.dataset.theme = 'dark';";
    const html = [
      `<script>${inline}</script>`,
      `<script type="module" src="/client.js"></script>`,
      `<script type="application/ld+json">{"a":1}</script>`,
      `<script type="module">import "/x.js"</script>`,
      `<script></script>`,
    ].join("\n");
    expect(inlineScriptHashes(html)).toEqual([sha256Of(inline), sha256Of(`import "/x.js"`)]);
  });
});

describe("readCspHashes", () => {
  let dir = "";
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kumiko-csp-hashes-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("missing file", () => {
    expect(readCspHashes(dir)).toEqual({ kind: "missing" });
  });

  test("rejects entries that are not sha256 hashes", async () => {
    await writeFile(join(dir, CSP_HASHES_FILE), JSON.stringify({ scriptSrc: ["'unsafe-inline'"] }));
    expect(readCspHashes(dir).kind).toBe("invalid");
    await writeFile(join(dir, CSP_HASHES_FILE), "{not json");
    expect(readCspHashes(dir).kind).toBe("invalid");
  });

  test("resolveCspScriptHashes warns once about a missing file and returns no hashes", () => {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      expect(resolveCspScriptHashes(dir, undefined)).toEqual([]);
      expect(resolveCspScriptHashes(dir, { csp: false })).toEqual([]);
      expect(resolveCspScriptHashes(dir, { csp: "default-src 'self'" })).toEqual([]);
      expect(resolveCspScriptHashes(undefined, undefined)).toEqual([]);
    } finally {
      console.warn = original;
    }
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(CSP_HASHES_FILE);
  });
});

describe("build output to CSP header", () => {
  let tmp = "";
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "kumiko-csp-build-"));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  test("inline scripts of templates and public html end up in csp-hashes.json and the header", async () => {
    const themeScript = "try{document.documentElement.dataset.theme=localStorage.theme}catch(e){}";
    const landingScript = "window.__landing = true;";
    await mkdir(join(tmp, "src"), { recursive: true });
    await writeFile(join(tmp, "src/client.ts"), `console.log("hi");`);
    await mkdir(join(tmp, "public"), { recursive: true });
    await writeFile(
      join(tmp, "public/index.html"),
      `<!doctype html><html><head><script>${themeScript}</script></head><body><script type="module" src="/client.js"></script></body></html>`,
    );
    await writeFile(
      join(tmp, "public/landing.html"),
      `<!doctype html><html><body><script>${landingScript}</script></body></html>`,
    );
    await writeFile(join(tmp, "package.json"), `{"name":"csp-fixture","private":true}`);

    await buildProdBundle({ cwd: tmp, stylesheet: false });

    const dist = join(tmp, "dist");
    const expected = [sha256Of(themeScript), sha256Of(landingScript)].sort();
    expect(readCspHashes(dist)).toEqual({ kind: "found", scriptSrc: expected });
    expect(collectBuildScriptHashes(dist).scriptSrc).toEqual(expected);

    const hashes = resolveCspScriptHashes(dist, undefined);
    const res = await withSecurityHeaders(
      () => new Response("ok"),
      undefined,
      hashes,
    )(new Request("http://localhost/"));
    const csp = res.headers.get("content-security-policy") ?? "";
    for (const hash of expected) expect(csp).toContain(`'${hash}'`);
  });
});
