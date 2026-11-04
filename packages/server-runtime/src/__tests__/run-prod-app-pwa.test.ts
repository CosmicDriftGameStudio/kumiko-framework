import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NO_ROUTE_MATCH_HEADER_NAME } from "@cosmicdrift/kumiko-framework/api";
import type { PwaOptions } from "../pwa.ts";
import { loadProdPwaShell } from "../run-prod-app-pwa.ts";
import { buildStaticFallback } from "../run-prod-app-static-files.ts";
import { runServiceWorkerScript, SANDBOX_ORIGIN } from "./_pwa-service-worker-sandbox.ts";

const pwa: PwaOptions = {
  name: "Tasks Pro",
  shortName: "Tasks",
  themeColor: "#0f172a",
  backgroundColor: "#ffffff",
  icons: [{ src: "/icons/192.png", sizes: "192x192", type: "image/png" }],
};

const INDEX_HTML =
  '<!doctype html><html><head><title>App</title></head><body><script type="module" src="/assets/client-abc.js"></script></body></html>';

function noRouteMatched(): Response {
  return new Response("404", { status: 404, headers: { [NO_ROUTE_MATCH_HEADER_NAME]: "1" } });
}

let staticDir = "";

beforeEach(async () => {
  staticDir = await mkdtemp(join(tmpdir(), "kumiko-pwa-"));
  await writeFile(join(staticDir, "index.html"), INDEX_HTML);
  await writeFile(
    join(staticDir, "manifest.json"),
    JSON.stringify({
      "client.js": "/assets/client-abc.js",
      "styles.css": "/assets/styles-def.css",
    }),
  );
  await writeFile(join(staticDir, "build-info.json"), JSON.stringify({ id: "build-1" }));
  await writeFile(join(staticDir, "sw.js"), "// the app's own file on disk");
});

afterEach(async () => {
  await rm(staticDir, { recursive: true, force: true });
});

async function fallbackWith(pwaOptions: PwaOptions | undefined) {
  const shell = await loadProdPwaShell(pwaOptions, staticDir);
  return buildStaticFallback(
    noRouteMatched,
    staticDir,
    undefined,
    undefined,
    undefined,
    0,
    [],
    shell,
  );
}

describe("loadProdPwaShell", () => {
  test("no pwa option, no shell", async () => {
    expect(await loadProdPwaShell(undefined, staticDir)).toBeUndefined();
  });

  test("pwa without staticDir fails the boot", async () => {
    await expect(loadProdPwaShell(pwa, undefined)).rejects.toThrow(/needs `staticDir`/);
  });

  test("the worker precaches the hashed bundles kumiko build wrote", async () => {
    const shell = await loadProdPwaShell(pwa, staticDir);
    const res = shell?.respond(new Request(`${SANDBOX_ORIGIN}/sw.js`), "/sw.js");
    const worker = runServiceWorkerScript((await res?.text()) ?? "");
    await worker.install();
    expect(worker.networkRequests.sort()).toEqual(
      [
        "/",
        "/manifest.webmanifest",
        "/icons/192.png",
        "/assets/client-abc.js",
        "/assets/styles-def.css",
      ].sort(),
    );
  });

  test("a new build id gives a new cache name", async () => {
    const first = (await loadProdPwaShell(pwa, staticDir))?.cacheName;
    await writeFile(join(staticDir, "build-info.json"), JSON.stringify({ id: "build-2" }));
    expect((await loadProdPwaShell(pwa, staticDir))?.cacheName).not.toBe(first);
  });

  test("missing or broken build files still give a shell", async () => {
    await writeFile(join(staticDir, "manifest.json"), "{not json");
    await rm(join(staticDir, "build-info.json"));
    expect((await loadProdPwaShell(pwa, staticDir))?.cacheName).toMatch(/^kumiko-pwa-/);
  });
});

describe("buildStaticFallback with pwa", () => {
  test("the index shell carries the PWA head tags and a validator over the injected bytes", async () => {
    const fallback = await fallbackWith(pwa);
    const res = await fallback(new Request("http://app.test/tasks/1"));
    const html = await res.text();
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toContain('<meta name="kumiko-pwa-sw" content="/sw.js" />');
    expect(res.headers.get("etag")).not.toMatch(/^W\//);
    expect(res.headers.get("last-modified")).toBeNull();
  });

  test("serves the manifest and the generated worker instead of the disk file", async () => {
    const fallback = await fallbackWith(pwa);
    const manifest = await fallback(new Request("http://app.test/manifest.webmanifest"));
    expect(manifest.headers.get("content-type")).toBe("application/manifest+json");
    expect(await manifest.json()).toMatchObject({ name: "Tasks Pro", short_name: "Tasks" });
    const worker = await fallback(new Request("http://app.test/sw.js"));
    expect(worker.headers.get("cache-control")).toBe("no-cache");
    expect(await worker.text()).not.toContain("the app's own file on disk");
  });

  test("without pwa the shell is untouched and /sw.js stays the app's disk file", async () => {
    const fallback = await fallbackWith(undefined);
    expect(await (await fallback(new Request("http://app.test/"))).text()).toBe(INDEX_HTML);
    expect(await (await fallback(new Request("http://app.test/sw.js"))).text()).toBe(
      "// the app's own file on disk",
    );
    const manifest = await fallback(new Request("http://app.test/manifest.webmanifest"));
    expect(manifest.headers.get("content-type")).not.toBe("application/manifest+json");
  });
});
