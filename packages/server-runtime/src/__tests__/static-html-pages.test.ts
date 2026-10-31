import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeStaticHtmlPages } from "../static-html-pages.ts";

describe("writeStaticHtmlPages", () => {
  let outDir: string;

  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), "kumiko-static-pages-"));
  });

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  test("writes index.html per page, root and nested", async () => {
    await writeStaticHtmlPages(outDir, [
      { path: "", html: "<h1>root</h1>" },
      { path: "de/features", html: "<h1>Funktionen äöü</h1>" },
    ]);
    expect(await readFile(join(outDir, "index.html"), "utf-8")).toBe("<h1>root</h1>");
    expect(await readFile(join(outDir, "de", "features", "index.html"), "utf-8")).toBe(
      "<h1>Funktionen äöü</h1>",
    );
  });

  test.each(["../x", "a/../../x", "/abs", "a\\b"])("rejects %p and writes nothing", async (bad) => {
    await expect(
      writeStaticHtmlPages(outDir, [
        { path: "ok", html: "fine" },
        { path: bad, html: "evil" },
      ]),
    ).rejects.toThrow(/writeStaticHtmlPages/);
    expect(await readdir(outDir)).toEqual([]);
  });
});
