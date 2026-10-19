import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AnonymousExtraRouteDeps } from "@cosmicdrift/kumiko-framework/api";
import { createRegistry } from "@cosmicdrift/kumiko-framework/engine";
import { Hono } from "hono";
import { diskFileRoute } from "../disk-file-route.ts";

describe("diskFileRoute", () => {
  let tmp = "";
  let fontPath = "";
  let requested: string[] = [];

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "kumiko-disk-file-route-"));
    fontPath = join(tmp, "inter.woff2");
    await writeFile(fontPath, new Uint8Array([0x77, 0x4f, 0x46, 0x32]));
    requested = [];
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  function mountedApp(): Hono {
    const route = diskFileRoute({
      path: "/fonts/:file",
      resolveFile: (file) => {
        requested.push(file);
        return file === "inter.woff2" ? fontPath : null;
      },
    });
    const app = new Hono();
    const deps: AnonymousExtraRouteDeps = {
      app,
      registry: createRegistry([]),
      systemQuery: async () => {
        throw new Error("unused");
      },
      write: async () => {
        throw new Error("unused");
      },
      clientIp: "127.0.0.1",
    };
    app.get(route.path, (c) => route.handler(c, deps));
    return app;
  }

  test("serves the resolved file with its mime type and an ETag", async () => {
    const res = await mountedApp().request("/fonts/inter.woff2");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("font/woff2");
    expect(res.headers.get("etag")).not.toBeNull();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      new Uint8Array([0x77, 0x4f, 0x46, 0x32]),
    );
  });

  test("answers 304 for a matching If-None-Match", async () => {
    const app = mountedApp();
    const etag = (await app.request("/fonts/inter.woff2")).headers.get("etag") ?? "";

    const res = await app.request("/fonts/inter.woff2", { headers: { "if-none-match": etag } });

    expect(res.status).toBe(304);
  });

  test("answers 404 for a name the resolver rejects", async () => {
    const res = await mountedApp().request("/fonts/other.woff2");

    expect(res.status).toBe(404);
  });

  test("answers 404 when the resolved file is missing on disk", async () => {
    await rm(fontPath);

    const res = await mountedApp().request("/fonts/inter.woff2");

    expect(res.status).toBe(404);
  });

  test.each(["..%2Fx", "..%5Cx", ".env", "..", "inter.woff2%00", "a%2Fb", "a%5Cb", "a%00b"])(
    "rejects %s before resolveFile runs",
    async (name) => {
      const res = await mountedApp().request(`/fonts/${name}`);

      expect(res.status).toBe(404);
      expect(requested).toEqual([]);
    },
  );

  test("throws when the path has no :file parameter", () => {
    expect(() => diskFileRoute({ path: "/fonts", resolveFile: () => null })).toThrow(":file");
  });
});
