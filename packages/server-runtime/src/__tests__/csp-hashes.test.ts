import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NO_ROUTE_MATCH_HEADER_NAME } from "@cosmicdrift/kumiko-framework/api";
import { buildProdBundle, collectBuildScriptHashes } from "../build-prod-bundle.ts";
import { CSP_HASHES_FILE, inlineScriptHashes, parseCspHashes } from "../csp-hashes.ts";
import {
  buildStaticFallback,
  resolveCspScriptHashes,
  resolveHostDispatchScriptHashes,
} from "../run-prod-app-static-files.ts";
import { buildDefaultCsp, withSecurityHeaders } from "../security-headers.ts";

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

describe("inlineScriptHashes quoted attributes", () => {
  test("a > inside a quoted attribute value does not truncate the hashed content", () => {
    const inline = "window.x = 1;";
    const html = `<script data-cfg="a>b" data-other='c>d'>${inline}</script>`;
    expect(inlineScriptHashes(html)).toEqual([sha256Of(inline)]);
  });
});

describe("parseCspHashes", () => {
  test("accepts a list of sha256 hashes", () => {
    const hash = `sha256-${"A".repeat(43)}=`;
    expect(parseCspHashes(JSON.stringify({ scriptSrc: [hash] }))).toEqual({
      kind: "found",
      scriptSrc: [hash],
    });
  });

  test("rejects entries that are not sha256 hashes and broken json", () => {
    expect(parseCspHashes(JSON.stringify({ scriptSrc: ["'unsafe-inline'"] })).kind).toBe("invalid");
    expect(parseCspHashes(JSON.stringify({ scriptSrc: ["sha256-x' 'unsafe-inline"] })).kind).toBe(
      "invalid",
    );
    expect(parseCspHashes("{not json").kind).toBe("invalid");
  });
});

describe("resolveCspScriptHashes", () => {
  let dir = "";
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kumiko-csp-hashes-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function warningsDuring(run: () => Promise<void>): Promise<string[]> {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      await run();
    } finally {
      console.warn = original;
    }
    return warnings;
  }

  test("warns about a missing file and returns no hashes; opt-outs stay silent", async () => {
    const warnings = await warningsDuring(async () => {
      expect(await resolveCspScriptHashes(dir, undefined)).toEqual([]);
      expect(await resolveCspScriptHashes(dir, { csp: false })).toEqual([]);
      expect(await resolveCspScriptHashes(dir, { csp: "default-src 'self'" })).toEqual([]);
      expect(await resolveCspScriptHashes(dir, false)).toEqual([]);
      expect(await resolveCspScriptHashes(undefined, undefined)).toEqual([]);
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(CSP_HASHES_FILE);
  });

  test("warns about an invalid file", async () => {
    await writeFile(join(dir, CSP_HASHES_FILE), "{not json");
    const warnings = await warningsDuring(async () => {
      expect(await resolveCspScriptHashes(dir, undefined)).toEqual([]);
    });
    expect(warnings[0]).toContain("is invalid");
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
    expect(JSON.parse(await readFile(join(dist, CSP_HASHES_FILE), "utf8"))).toEqual({
      scriptSrc: expected,
    });
    expect(collectBuildScriptHashes(dist).scriptSrc).toEqual(expected);

    const hashes = await resolveCspScriptHashes(dist, undefined);
    const res = await withSecurityHeaders(
      () => new Response("ok"),
      undefined,
      hashes,
    )(new Request("http://localhost/"));
    const csp = res.headers.get("content-security-policy") ?? "";
    for (const hash of expected) expect(csp).toContain(`'${hash}'`);
  });
});

describe("hostDispatch csp hashes", () => {
  let dir = "";
  const hash = `sha256-${"A".repeat(43)}=`;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kumiko-csp-hostdispatch-"));
    await writeFile(join(dir, CSP_HASHES_FILE), JSON.stringify({ scriptSrc: [hash] }));
    await writeFile(join(dir, "tenant.html"), "<!doctype html><html><body>ok</body></html>");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("reads the build hashes even when securityHeaders.csp is a custom string", async () => {
    expect(await resolveHostDispatchScriptHashes(dir, { csp: "default-src 'self'" }, [])).toEqual([
      hash,
    ]);
    expect(await resolveHostDispatchScriptHashes(dir, undefined, [hash])).toEqual([hash]);
  });

  test("a per-host csp built from deps.cspScriptHashes carries the sha256 source", async () => {
    const hashes = await resolveHostDispatchScriptHashes(dir, { csp: false }, []);
    const handler = buildStaticFallback(
      () => new Response("404", { status: 404, headers: { [NO_ROUTE_MATCH_HEADER_NAME]: "1" } }),
      dir,
      (_req, deps) => ({
        kind: "html",
        file: "tenant.html",
        csp: buildDefaultCsp(deps.cspScriptHashes),
      }),
      undefined,
      undefined,
      0,
      hashes,
    );
    const res = await handler(new Request("http://t/", { headers: { host: "a.example" } }));
    expect(res.headers.get("content-security-policy")).toContain(`'${hash}'`);
  });
});
