// Unit-Tests für die Pure-Logic-Helpers von build-prod-bundle.
//
// Bun.build und Tailwind-CLI brauchen einen Bun-Runtime, deshalb
// werden die hier nicht aufgerufen — nur Discovery + HTML-Injection
// die unter Node funktionieren. End-to-End-Tests (mit echtem Bun.build)
// laufen im CI als `yarn build` auf der Showcase-App; das ist der
// ehrlichere Smoke-Test.

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  type ClientEntry,
  discoverClientEntries,
  discoverClientEntry,
  discoverHtmlTemplate,
  injectAssetTags,
} from "../build-prod-bundle";

// Synthetic single-entry helper. Realer Build erzeugt das via
// discoverClientEntries; hier reicht die Form für injectAssetTags-Tests.
function clientEntry(): ClientEntry {
  return {
    name: "client",
    sourceFile: "src/client.tsx",
    manifestKey: "client.js",
    htmlPath: "index.html",
  };
}

function namedEntry(name: string): ClientEntry {
  return {
    name,
    sourceFile: `src/client-${name}.tsx`,
    manifestKey: `client-${name}.js`,
    htmlPath: name === "public" ? "index.html" : `${name}.html`,
  };
}

describe("build-prod-bundle/discovery", () => {
  let workDir = "";

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "kumiko-build-test-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  test("discoverClientEntry findet src/client.tsx wenn vorhanden", async () => {
    await mkdir(join(workDir, "src"), { recursive: true });
    await writeFile(join(workDir, "src/client.tsx"), "// noop");

    const entry = discoverClientEntry(workDir);

    expect(entry).toBe(join(workDir, "src/client.tsx"));
  });

  test("discoverClientEntry findet src/client.ts als Fallback", async () => {
    await mkdir(join(workDir, "src"), { recursive: true });
    await writeFile(join(workDir, "src/client.ts"), "// noop");

    const entry = discoverClientEntry(workDir);

    expect(entry).toBe(join(workDir, "src/client.ts"));
  });

  test("discoverClientEntry bevorzugt .tsx über .ts wenn beide existieren", async () => {
    await mkdir(join(workDir, "src"), { recursive: true });
    await writeFile(join(workDir, "src/client.tsx"), "// jsx");
    await writeFile(join(workDir, "src/client.ts"), "// ts");

    const entry = discoverClientEntry(workDir);

    expect(entry).toBe(join(workDir, "src/client.tsx"));
  });

  test("discoverClientEntry gibt undefined zurück wenn nichts da ist", () => {
    expect(discoverClientEntry(workDir)).toBeUndefined();
  });

  test("discoverClientEntries findet single-mode src/client.tsx", async () => {
    await mkdir(join(workDir, "src"), { recursive: true });
    await writeFile(join(workDir, "src/client.tsx"), "// single");

    const entries = discoverClientEntries(workDir);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe("client");
    expect(entries[0]?.manifestKey).toBe("client.js");
    expect(entries[0]?.htmlPath).toBe("index.html");
  });

  test("discoverClientEntries findet multi-mode client-public + client-admin", async () => {
    await mkdir(join(workDir, "src"), { recursive: true });
    await writeFile(join(workDir, "src/client-public.tsx"), "// public");
    await writeFile(join(workDir, "src/client-admin.tsx"), "// admin");

    const entries = discoverClientEntries(workDir);

    // Sortiert nach name.
    expect(entries.map((e) => e.name)).toEqual(["admin", "public"]);

    const admin = entries.find((e) => e.name === "admin");
    expect(admin?.manifestKey).toBe("client-admin.js");
    expect(admin?.htmlPath).toBe("admin.html");

    const pub = entries.find((e) => e.name === "public");
    expect(pub?.manifestKey).toBe("client-public.js");
    // "public" mappt auf das Default-Template (index.html), nicht
    // public.html — das ist Convention damit das default-served-Template
    // den vom-User-erwarteten Namen behält.
    expect(pub?.htmlPath).toBe("index.html");
  });

  test("discoverClientEntries multi-mode dominiert über single-mode wenn beide da", async () => {
    await mkdir(join(workDir, "src"), { recursive: true });
    await writeFile(join(workDir, "src/client.tsx"), "// single");
    await writeFile(join(workDir, "src/client-admin.tsx"), "// admin");

    const entries = discoverClientEntries(workDir);

    // Multi-mode aktiv → "client" wird ignoriert.
    expect(entries.map((e) => e.name)).toEqual(["admin"]);
  });

  test("discoverClientEntries gibt leeres Array zurück wenn nichts da", () => {
    expect(discoverClientEntries(workDir)).toEqual([]);
  });

  test("discoverHtmlTemplate findet index.html im cwd", async () => {
    await writeFile(join(workDir, "index.html"), "<html></html>");

    expect(discoverHtmlTemplate(workDir)).toBe(join(workDir, "index.html"));
  });

  test("discoverHtmlTemplate findet public/index.html als Fallback", async () => {
    await mkdir(join(workDir, "public"), { recursive: true });
    await writeFile(join(workDir, "public/index.html"), "<html></html>");

    expect(discoverHtmlTemplate(workDir)).toBe(join(workDir, "public/index.html"));
  });

  test("discoverHtmlTemplate bevorzugt cwd-index.html über public/index.html", async () => {
    await mkdir(join(workDir, "public"), { recursive: true });
    await writeFile(join(workDir, "index.html"), "<!-- root -->");
    await writeFile(join(workDir, "public/index.html"), "<!-- public -->");

    expect(discoverHtmlTemplate(workDir)).toBe(join(workDir, "index.html"));
  });

  test("discoverHtmlTemplate gibt undefined zurück wenn nichts da ist", () => {
    expect(existsSync(workDir)).toBe(true);
    expect(discoverHtmlTemplate(workDir)).toBeUndefined();
  });
});

describe("build-prod-bundle/injectAssetTags", () => {
  test("ersetzt /client.js durch hashed URL im script-tag", () => {
    const html = `<html><body><script type="module" src="/client.js"></script></body></html>`;
    const result = injectAssetTags(
      html,
      { "client.js": "/assets/client-abc123.js" },
      clientEntry(),
    );

    expect(result).toContain('src="/assets/client-abc123.js"');
    expect(result).not.toContain('src="/client.js"');
  });

  test("ersetzt /styles.css durch hashed URL im link-tag", () => {
    const html = `<html><head><link rel="stylesheet" href="/styles.css" /></head><body></body></html>`;
    const result = injectAssetTags(
      html,
      { "styles.css": "/assets/styles-def456.css" },
      clientEntry(),
    );

    expect(result).toContain('href="/assets/styles-def456.css"');
    expect(result).not.toContain('href="/styles.css"');
  });

  test("wirft mit Anweisung wenn /client.js Placeholder fehlt", () => {
    const html = `<html><body><div id="root"></div></body></html>`;

    expect(() =>
      injectAssetTags(html, { "client.js": "/assets/client-abc.js" }, clientEntry()),
    ).toThrow(/keinen Entry-Tag für \/client\.js/);
    expect(() =>
      injectAssetTags(html, { "client.js": "/assets/client-abc.js" }, clientEntry()),
    ).toThrow(/<script type="module" src="\/client\.js"><\/script>/);
  });

  test("wirft mit Anweisung wenn /styles.css Placeholder fehlt", () => {
    const html = `<html><head><title>App</title></head><body></body></html>`;

    expect(() =>
      injectAssetTags(html, { "styles.css": "/assets/styles-xyz.css" }, clientEntry()),
    ).toThrow(/keinen Entry-Tag für \/styles\.css/);
    expect(() =>
      injectAssetTags(html, { "styles.css": "/assets/styles-xyz.css" }, clientEntry()),
    ).toThrow(/<link rel="stylesheet" href="\/styles\.css" \/>/);
  });

  test("ist idempotent — zweite Injection auf bereits ersetztem HTML ändert nichts", () => {
    const html = `<html><body><script type="module" src="/client.js"></script></body></html>`;
    const manifest = { "client.js": "/assets/client-abc.js" };
    const first = injectAssetTags(html, manifest, clientEntry());
    const second = injectAssetTags(first, manifest, clientEntry());

    expect(first).toBe(second);
    expect(first).toContain('src="/assets/client-abc.js"');
  });

  test("ändert template ohne client/styles im manifest nicht", () => {
    const html = `<html><body>Hello</body></html>`;
    const result = injectAssetTags(html, {}, clientEntry());

    expect(result).toBe(html);
  });

  test("verträgt mehrere script-tags und ersetzt nur den /client.js", () => {
    const html = `<html><body>
      <script>console.log("inline");</script>
      <script type="module" src="/client.js"></script>
    </body></html>`;
    const result = injectAssetTags(html, { "client.js": "/assets/client-x.js" }, clientEntry());

    expect(result).toContain('console.log("inline")');
    expect(result).toContain('src="/assets/client-x.js"');
    expect(result).not.toContain('src="/client.js"');
  });

  test("multi-mode: admin-entry ersetzt nur /client-admin.js, lässt /client-public.js liegen", () => {
    const html = `<html><body>
      <script type="module" src="/client-admin.js"></script>
      <script type="module" src="/client-public.js"></script>
    </body></html>`;
    const manifest = {
      "client-admin.js": "/assets/client-admin-aaa.js",
      "client-public.js": "/assets/client-public-bbb.js",
    };
    const result = injectAssetTags(html, manifest, namedEntry("admin"));

    expect(result).toContain('src="/assets/client-admin-aaa.js"');
    // public-bundle bleibt unangetastet — admin.html lädt nur sein eigenes Bundle.
    expect(result).toContain('src="/client-public.js"');
    expect(result).not.toContain('src="/client-admin.js"');
  });

  test("multi-mode: error-message nennt den richtigen Template-Namen", () => {
    const html = `<html><body>no admin script</body></html>`;
    const manifest = { "client-admin.js": "/assets/client-admin-x.js" };

    expect(() => injectAssetTags(html, manifest, namedEntry("admin"))).toThrow(
      /admin\.html hat keinen Entry-Tag für \/client-admin\.js/,
    );
  });
});
