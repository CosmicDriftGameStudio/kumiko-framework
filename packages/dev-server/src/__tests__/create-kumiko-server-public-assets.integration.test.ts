import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { createKumikoServer, type KumikoServerHandle } from "../create-kumiko-server.ts";
import { probeFeature } from "./create-kumiko-server-probe.ts";

let handle: KumikoServerHandle | undefined;

afterEach(async () => {
  if (handle) {
    await handle.stop();
    handle = undefined;
  }
});

// A dotted GET path (e.g. /marketing/hero.png) used to fall through the SPA
// catch-all's "no dot" filter straight to the API stack and 404 — works in
// prod (buildStaticFallback's disk lookup under staticDir) but not dev,
// which had no public/-serving at all. publicDir is process.cwd()-relative
// (same App-Root convention as resolveStylesheet's src/styles.css lookup),
// so these tests chdir into a fixture directory for the boot.
const probeRobotsRouteFeature = defineFeature("dev-server-probe-robots-route", (r) => {
  r.httpRoute({
    method: "GET",
    path: "/robots.txt",
    anonymous: true,
    handler: async (c) => c.text("ROUTE-ROBOTS", 200),
  });
});

describe("createKumikoServer — public/ static files", () => {
  test("GET on an existing file under public/ → 200, correct content-type + content", async () => {
    const tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "kumiko-public-")));
    const publicDir = join(tmpDir, "public");
    mkdirSync(join(publicDir, "marketing"), { recursive: true });
    writeFileSync(join(publicDir, "marketing", "hero.png"), "PNGDATA");
    const cwdBefore = process.cwd();
    process.chdir(tmpDir);
    try {
      handle = await createKumikoServer({
        features: [probeFeature],
        port: 0,
        installSignalHandlers: false,
      });
      const res = await handle.fetch(new Request("http://localhost/marketing/hero.png"));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      expect(await res.text()).toBe("PNGDATA");
    } finally {
      process.chdir(cwdBefore);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("a .webp file under public/ is served as image/webp", async () => {
    const tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "kumiko-public-")));
    mkdirSync(join(tmpDir, "public"), { recursive: true });
    writeFileSync(join(tmpDir, "public", "photo.webp"), "WEBPDATA");
    const cwdBefore = process.cwd();
    process.chdir(tmpDir);
    try {
      handle = await createKumikoServer({
        features: [probeFeature],
        port: 0,
        installSignalHandlers: false,
      });
      const res = await handle.fetch(new Request("http://localhost/photo.webp"));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/webp");
    } finally {
      process.chdir(cwdBefore);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("traversal attempts never serve a file from outside public/", async () => {
    const tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "kumiko-public-traversal-")));
    const publicDir = join(tmpDir, "public");
    mkdirSync(publicDir, { recursive: true });
    // Secret sits as a SIBLING of public/ — a traversal that escapes
    // containment would read this instead of 404ing.
    writeFileSync(join(tmpDir, "secret.txt"), "TOP-SECRET");
    const cwdBefore = process.cwd();
    process.chdir(tmpDir);
    try {
      handle = await createKumikoServer({
        features: [probeFeature],
        port: 0,
        installSignalHandlers: false,
      });

      // WHATWG URL parsing already collapses a literal ".." segment (it's
      // delimited by a real "/"), so this pins the composed behavior —
      // request never reaches secret.txt — rather than the guard itself.
      const literal = await handle.fetch(new Request("http://localhost/../secret.txt"));
      expect(literal.status).not.toBe(200);

      // %2e%2e%2f is the actual vector the decode+resolve+containment guard
      // exists for: URL path-parsing only normalizes dot-segments split by a
      // literal "/", so an encoded slash survives untouched into pathname —
      // without the explicit decode in resolvePublicFilePath this would
      // resolve straight to tmpDir/secret.txt.
      const encoded = await handle.fetch(new Request("http://localhost/%2e%2e%2fsecret.txt"));
      expect(encoded.status).not.toBe(200);

      // A decoded NUL byte must be a router miss, not a readFile throw -> 500.
      const nul = await handle.fetch(new Request("http://localhost/foo%00.png"));
      expect(nul.status).toBe(404);

      // Neither attempt leaked the secret's content through any other path
      // (e.g. as an error body).
      expect(await literal.clone().text()).not.toContain("TOP-SECRET");
      expect(await encoded.clone().text()).not.toContain("TOP-SECRET");
    } finally {
      process.chdir(cwdBefore);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("a symlink under public/ pointing outside it is never served", async () => {
    const tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "kumiko-public-symlink-")));
    const publicDir = join(tmpDir, "public");
    mkdirSync(publicDir, { recursive: true });
    writeFileSync(join(tmpDir, "secret.txt"), "TOP-SECRET");
    // Lexically inside public/, so resolvePublicFilePath's containment check
    // passes; only the realpath guard in servePublicFile catches the escape.
    symlinkSync(join(tmpDir, "secret.txt"), join(publicDir, "leak.txt"));
    const cwdBefore = process.cwd();
    process.chdir(tmpDir);
    try {
      handle = await createKumikoServer({
        features: [probeFeature],
        port: 0,
        installSignalHandlers: false,
      });
      const res = await handle.fetch(new Request("http://localhost/leak.txt"));
      expect(res.status).not.toBe(200);
      expect(await res.text()).not.toContain("TOP-SECRET");
    } finally {
      process.chdir(cwdBefore);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("a public/ that is itself a symlink still serves its files", async () => {
    const tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "kumiko-public-linkdir-")));
    const sharedAssets = join(tmpDir, "shared-assets");
    mkdirSync(sharedAssets, { recursive: true });
    writeFileSync(join(sharedAssets, "logo.png"), "PNGDATA");
    writeFileSync(join(tmpDir, "secret.txt"), "TOP-SECRET");
    symlinkSync(sharedAssets, join(tmpDir, "public"));
    const cwdBefore = process.cwd();
    process.chdir(tmpDir);
    try {
      handle = await createKumikoServer({
        features: [probeFeature],
        port: 0,
        installSignalHandlers: false,
      });
      const res = await handle.fetch(new Request("http://localhost/logo.png"));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("PNGDATA");
      const encoded = await handle.fetch(new Request("http://localhost/%2e%2e%2fsecret.txt"));
      expect(encoded.status).not.toBe(200);
      const backslash = await handle.fetch(new Request("http://localhost/..%5Csecret.txt"));
      expect(backslash.status).not.toBe(200);
    } finally {
      process.chdir(cwdBefore);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("an r.httpRoute owning a dotted path wins over the file in public/", async () => {
    const tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "kumiko-public-route-")));
    const publicDir = join(tmpDir, "public");
    mkdirSync(publicDir, { recursive: true });
    writeFileSync(join(publicDir, "robots.txt"), "FILE-ROBOTS");
    const cwdBefore = process.cwd();
    process.chdir(tmpDir);
    try {
      handle = await createKumikoServer({
        features: [probeRobotsRouteFeature],
        port: 0,
        installSignalHandlers: false,
      });
      const res = await handle.fetch(new Request("http://localhost/robots.txt"));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ROUTE-ROBOTS");
    } finally {
      process.chdir(cwdBefore);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("HEAD on a file under public/ → 200 with the file's content-type", async () => {
    const tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "kumiko-public-head-")));
    const publicDir = join(tmpDir, "public");
    mkdirSync(join(publicDir, "marketing"), { recursive: true });
    writeFileSync(join(publicDir, "marketing", "hero.png"), "PNGDATA");
    const cwdBefore = process.cwd();
    process.chdir(tmpDir);
    try {
      handle = await createKumikoServer({
        features: [probeFeature],
        port: 0,
        installSignalHandlers: false,
      });
      const res = await handle.fetch(
        new Request("http://localhost/marketing/hero.png", { method: "HEAD" }),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
    } finally {
      process.chdir(cwdBefore);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("a dot-less path still hits the SPA catch-all, not the public/-file lookup", async () => {
    const tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "kumiko-public-spa-")));
    const publicDir = join(tmpDir, "public");
    mkdirSync(publicDir, { recursive: true });
    const cwdBefore = process.cwd();
    process.chdir(tmpDir);
    try {
      handle = await createKumikoServer({
        features: [probeFeature],
        port: 0,
        installSignalHandlers: false,
      });
      const res = await handle.fetch(new Request("http://localhost/some/client-route"));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/text\/html/);
      expect(await res.text()).toMatch(/<div id="root">/);
    } finally {
      process.chdir(cwdBefore);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("createKumikoServer — renderer/web fonts under /assets/kumiko/fonts", () => {
  const FONTS_SOURCE_DIR = join(import.meta.dir, "../../../renderer/src/web/fonts");

  async function withFixtureCwd(run: () => Promise<void>): Promise<void> {
    const tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "kumiko-fonts-")));
    const cwdBefore = process.cwd();
    process.chdir(tmpDir);
    try {
      handle = await createKumikoServer({
        features: [probeFeature],
        port: 0,
        installSignalHandlers: false,
      });
      await run();
    } finally {
      process.chdir(cwdBefore);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  test("GET on a shipped font → 200, font/woff2, the file's bytes", async () => {
    await withFixtureCwd(async () => {
      const res = await handle?.fetch(
        new Request("http://localhost/assets/kumiko/fonts/ibm-plex-sans-latin-400.woff2"),
      );
      expect(res?.status).toBe(200);
      expect(res?.headers.get("content-type")).toBe("font/woff2");
      const expected = readFileSync(join(FONTS_SOURCE_DIR, "ibm-plex-sans-latin-400.woff2"));
      expect(Buffer.from(await (res as Response).arrayBuffer()).equals(expected)).toBe(true);
    });
  });

  test("unknown names and traversal attempts → 404, never file content", async () => {
    await withFixtureCwd(async () => {
      for (const path of [
        "/assets/kumiko/fonts/nope.woff2",
        "/assets/kumiko/fonts/OFL.txt",
        "/assets/kumiko/fonts/../styles.css",
        "/assets/kumiko/fonts/..%2fstyles.css",
        "/assets/kumiko/fonts/%2e%2e%2f%2e%2e%2fpackage.json",
        "/assets/kumiko/fonts/ibm-plex-sans-latin-400.woff2/x",
      ]) {
        const res = await handle?.fetch(new Request(`http://localhost${path}`));
        expect(res?.status, path).toBe(404);
      }
    });
  });
});
