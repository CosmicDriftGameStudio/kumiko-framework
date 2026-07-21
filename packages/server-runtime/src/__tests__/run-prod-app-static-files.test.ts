// Unit coverage for mimeTypeFor + hostDispatch edge in buildStaticFallback.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildStaticFallback,
  mimeTypeFor,
  readStaticFile,
  serveDiskFile,
} from "../run-prod-app-static-files";

describe("mimeTypeFor", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["x.html", "text/html; charset=utf-8"],
    ["x.js", "text/javascript; charset=utf-8"],
    ["x.mjs", "text/javascript; charset=utf-8"],
    ["x.css", "text/css; charset=utf-8"],
    ["x.json", "application/json; charset=utf-8"],
    ["x.svg", "image/svg+xml"],
    ["x.png", "image/png"],
    ["x.jpg", "image/jpeg"],
    ["x.jpeg", "image/jpeg"],
    ["x.ico", "image/x-icon"],
    ["x.txt", "text/plain; charset=utf-8"],
    ["x.xml", "application/xml; charset=utf-8"],
    ["x.webmanifest", "application/manifest+json"],
    ["x.bin", "application/octet-stream"],
    ["noext", "application/octet-stream"],
  ];

  for (const [path, mime] of cases) {
    test(`${path} → ${mime}`, () => {
      expect(mimeTypeFor(path)).toBe(mime);
    });
  }
});

describe("readStaticFile / serveDiskFile", () => {
  let tmp = "";

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "kumiko-static-"));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  test("readStaticFile returns bytes+mime; ENOENT → undefined", async () => {
    const path = join(tmp, "a.css");
    await writeFile(path, "body{}");
    const file = await readStaticFile(path);
    expect(file?.mime).toBe("text/css; charset=utf-8");
    expect(new TextDecoder().decode(file!.bytes)).toBe("body{}");
    expect(await readStaticFile(join(tmp, "missing.css"))).toBeUndefined();
  });

  test("serveDiskFile sets content-type from mime", async () => {
    const path = join(tmp, "a.svg");
    await writeFile(path, "<svg/>");
    const file = await readStaticFile(path);
    const res = serveDiskFile(new Request("http://t/a.svg"), "/a.svg", file!);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(await res.text()).toBe("<svg/>");
  });
});

describe("buildStaticFallback hostDispatch", () => {
  let tmp = "";

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "kumiko-fallback-"));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  test("hostDispatch html pointing at missing file → 500", async () => {
    const handler = buildStaticFallback(
      () => new Response("api-404", { status: 404 }),
      tmp,
      "{}",
      () => ({ kind: "html", file: "gone.html" }),
    );
    const res = await handler(new Request("http://t/"));
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("hostDispatch: file not found: gone.html");
  });

  test("hostDispatch not-found → 404; redirect → 302", async () => {
    const notFound = buildStaticFallback(
      () => new Response("x", { status: 404 }),
      tmp,
      "{}",
      () => ({ kind: "not-found" }),
    );
    expect((await notFound(new Request("http://t/"))).status).toBe(404);

    const redirect = buildStaticFallback(
      () => new Response("x", { status: 404 }),
      tmp,
      "{}",
      () => ({ kind: "redirect", to: "https://example.com/", status: 301 }),
    );
    const res = await redirect(new Request("http://t/"));
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://example.com/");
  });

  test("/api/* always hits apiHandler", async () => {
    const handler = buildStaticFallback(
      () => new Response("from-api", { status: 200 }),
      tmp,
      "{}",
    );
    const res = await handler(new Request("http://t/api/query", { method: "POST" }));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("from-api");
  });

  test("serves disk asset under staticDir", async () => {
    await writeFile(join(tmp, "logo.png"), "PNGDATA");
    const handler = buildStaticFallback(
      () => new Response("404", { status: 404 }),
      tmp,
      "{}",
    );
    const res = await handler(new Request("http://t/logo.png"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(await res.text()).toBe("PNGDATA");
  });

  test("hostDispatch html with CSP + Vary: Host", async () => {
    await writeFile(join(tmp, "tenant.html"), "<!doctype html><html><body>ok</body></html>");
    const handler = buildStaticFallback(
      () => new Response("404", { status: 404 }),
      tmp,
      '{"screens":[]}',
      () => ({
        kind: "html",
        file: "tenant.html",
        injectSchema: false,
        csp: "default-src 'self'",
      }),
    );
    const res = await handler(new Request("http://t/", { headers: { host: "a.example" } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("vary")).toBe("Host");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'self'");
    expect(await res.text()).toContain("ok");
  });
});
