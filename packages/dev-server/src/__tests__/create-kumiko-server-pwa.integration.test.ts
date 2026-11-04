import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PwaOptions } from "@cosmicdrift/kumiko-server-runtime/pwa";
import { createKumikoServer, type KumikoServerHandle } from "../create-kumiko-server.ts";
import { probeFeature } from "./create-kumiko-server-probe.ts";

let handle: KumikoServerHandle | undefined;

afterEach(async () => {
  if (handle) {
    await handle.stop();
    handle = undefined;
  }
});

const pwa: PwaOptions = {
  name: "Tasks Pro",
  shortName: "Tasks",
  themeColor: "#0f172a",
  backgroundColor: "#ffffff",
  icons: [{ src: "/icons/192.png", sizes: "192x192", type: "image/png" }],
};

// public/ is cwd-relative in dev, so each boot runs inside a fixture directory with its own sw.js.
async function bootInFixture(pwaOption: PwaOptions | undefined): Promise<() => void> {
  const tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "kumiko-dev-pwa-")));
  mkdirSync(join(tmpDir, "public"), { recursive: true });
  writeFileSync(join(tmpDir, "public", "sw.js"), "// the app's own sw.js");
  const cwdBefore = process.cwd();
  process.chdir(tmpDir);
  handle = await createKumikoServer({
    features: [probeFeature],
    port: 0,
    installSignalHandlers: false,
    ...(pwaOption && { pwa: pwaOption }),
  });
  return () => {
    process.chdir(cwdBefore);
    rmSync(tmpDir, { recursive: true, force: true });
  };
}

describe("createKumikoServer — pwa", () => {
  test("with pwa the shell carries the PWA tags and both files are served", async () => {
    const cleanup = await bootInFixture(pwa);
    try {
      const shell = await handle?.fetch(new Request("http://localhost/tasks/1"));
      const html = (await shell?.text()) ?? "";
      expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
      expect(html).toContain('<meta name="kumiko-pwa-sw" content="/sw.js" />');

      const manifest = await handle?.fetch(new Request("http://localhost/manifest.webmanifest"));
      expect(manifest?.headers.get("content-type")).toBe("application/manifest+json");
      expect(await manifest?.json()).toMatchObject({ name: "Tasks Pro", display: "standalone" });

      const worker = await handle?.fetch(new Request("http://localhost/sw.js"));
      expect(worker?.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
      expect(await worker?.text()).not.toContain("the app's own sw.js");
    } finally {
      cleanup();
    }
  });

  test("without pwa the shell has no PWA tags and /sw.js stays the app's public file", async () => {
    const cleanup = await bootInFixture(undefined);
    try {
      const html = (await (await handle?.fetch(new Request("http://localhost/")))?.text()) ?? "";
      expect(html).not.toContain('rel="manifest"');
      expect(html).not.toContain("kumiko-pwa-sw");
      const worker = await handle?.fetch(new Request("http://localhost/sw.js"));
      expect(await worker?.text()).toBe("// the app's own sw.js");
    } finally {
      cleanup();
    }
  });
});
