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
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { discoverClientEntry, discoverHtmlTemplate, injectAssetTags } from "../build-prod-bundle";

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
    const result = injectAssetTags(html, { "client.js": "/assets/client-abc123.js" });

    expect(result).toContain('src="/assets/client-abc123.js"');
    expect(result).not.toContain('src="/client.js"');
  });

  test("ersetzt /styles.css durch hashed URL im link-tag", () => {
    const html = `<html><head><link rel="stylesheet" href="/styles.css" /></head><body></body></html>`;
    const result = injectAssetTags(html, { "styles.css": "/assets/styles-def456.css" });

    expect(result).toContain('href="/assets/styles-def456.css"');
    expect(result).not.toContain('href="/styles.css"');
  });

  test("injiziert script-tag in </body> wenn keine /client.js Referenz da ist", () => {
    const html = `<html><body><div id="root"></div></body></html>`;
    const result = injectAssetTags(html, { "client.js": "/assets/client-abc.js" });

    expect(result).toContain('<script type="module" src="/assets/client-abc.js"></script>');
    expect(result).toContain("</body>");
  });

  test("injiziert link-tag in </head> wenn keine /styles.css Referenz da ist", () => {
    const html = `<html><head><title>App</title></head><body></body></html>`;
    const result = injectAssetTags(html, { "styles.css": "/assets/styles-xyz.css" });

    expect(result).toContain('<link rel="stylesheet" href="/assets/styles-xyz.css"');
    // link muss vor </head> stehen
    const linkPos = result.indexOf('<link rel="stylesheet"');
    const headEndPos = result.indexOf("</head>");
    expect(linkPos).toBeLessThan(headEndPos);
    expect(linkPos).toBeGreaterThan(0);
  });

  test("ist idempotent — zweite Injection ändert nichts", () => {
    const html = `<html><body></body></html>`;
    const manifest = { "client.js": "/assets/client-abc.js" };
    const first = injectAssetTags(html, manifest);
    const second = injectAssetTags(first, manifest);

    expect(first).toBe(second);
  });

  test("ändert template ohne client/styles im manifest nicht", () => {
    const html = `<html><body>Hello</body></html>`;
    const result = injectAssetTags(html, {});

    expect(result).toBe(html);
  });

  test("verträgt mehrere script-tags und ersetzt nur den /client.js", () => {
    const html = `<html><body>
      <script>console.log("inline");</script>
      <script type="module" src="/client.js"></script>
    </body></html>`;
    const result = injectAssetTags(html, { "client.js": "/assets/client-x.js" });

    expect(result).toContain('console.log("inline")');
    expect(result).toContain('src="/assets/client-x.js"');
    expect(result).not.toContain('src="/client.js"');
  });
});
