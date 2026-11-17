import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apiDocsCommand } from "../api-docs";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// A config in tmpdir cannot resolve workspace packages by name, so the imports are absolute.
const resolve = (specifier: string): string => Bun.resolveSync(specifier, import.meta.dir);

const CONFIG = `
import { defineFeature } from "${resolve("@cosmicdrift/kumiko-framework/engine")}";
import * as z from "${resolve("zod")}";
import { createConfigFeature } from "${resolve("@cosmicdrift/kumiko-bundled-features/config")}";
import { createUserFeature } from "${resolve("@cosmicdrift/kumiko-bundled-features/user")}";
import { createTenantFeature } from "${resolve("@cosmicdrift/kumiko-bundled-features/tenant")}";
import { createAuthFoundationFeature } from "${resolve("@cosmicdrift/kumiko-bundled-features/auth-foundation")}";
import { createPersonalAccessTokensFeature } from "${resolve("@cosmicdrift/kumiko-bundled-features/personal-access-tokens")}";

const access = { openToAll: { reason: "cli test handler" } };
const ticketing = defineFeature("ticketing", (r) => {
  r.writeHandler({
    name: "ticket:close",
    schema: z.object({ id: z.uuid() }),
    handler: async () => ({ isSuccess: true, data: {} }),
    access,
    description: "Closes a ticket.",
  });
});

export default {
  features: [
    createConfigFeature(),
    createUserFeature(),
    createTenantFeature(),
    createAuthFoundationFeature(),
    ticketing,
    createPersonalAccessTokensFeature({
      scopes: { tickets: { label: "Tickets", read: [], write: ["ticketing:write:ticket:close"] } },
    }),
  ],
  apiDocs: { baseUrl: "https://api.example.test", appName: "Helpdesk" },
};
`;

function setup(config = CONFIG): string {
  const dir = mkdtempSync(join(tmpdir(), "kumiko-api-docs-"));
  tmpDirs.push(dir);
  writeFileSync(join(dir, "kumiko.config.ts"), config);
  return dir;
}

async function run(dir: string, argv: string[]): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  const code = await apiDocsCommand.run({
    argv,
    cwd: dir,
    out: { log: (l) => lines.push(l), err: (l) => lines.push(l) },
  });
  return { code, lines };
}

describe("kumiko api-docs", () => {
  test("writes the files, and --check on fresh output exits 0", async () => {
    const dir = setup();
    const written = await run(dir, ["--out", "docs/api"]);
    expect(written.code).toBe(0);
    expect(existsSync(join(dir, "docs/api/en/tokens.md"))).toBe(true);
    expect(existsSync(join(dir, "docs/api/openapi.json"))).toBe(true);

    const checked = await run(dir, ["--out", "docs/api", "--check"]);
    expect(checked.code).toBe(0);
  });

  test("--check reports a changed file with exit 1 and writes nothing", async () => {
    const dir = setup();
    await run(dir, ["--out", "docs/api", "--locales", "en"]);
    const tokens = join(dir, "docs/api/en/tokens.md");
    writeFileSync(tokens, `${readFileSync(tokens, "utf8")}edited\n`);
    writeFileSync(join(dir, "docs/api/en/stray.md"), "x");

    const checked = await run(dir, ["--out", "docs/api", "--locales", "en", "--check"]);
    expect(checked.code).toBe(1);
    expect(checked.lines.join("\n")).toContain("[changed] en/tokens.md");
    expect(checked.lines.join("\n")).toContain("[extra] en/stray.md");
    expect(readFileSync(tokens, "utf8").endsWith("edited\n")).toBe(true);
  });

  test("a rerun deletes pages that are no longer generated, never foreign files", async () => {
    const dir = setup();
    await run(dir, ["--out", "docs/api", "--locales", "en,de"]);
    writeFileSync(join(dir, "docs/api/notes.txt"), "mine");
    await run(dir, ["--out", "docs/api", "--locales", "en"]);
    expect(existsSync(join(dir, "docs/api/de/tokens.md"))).toBe(false);
    expect(existsSync(join(dir, "docs/api/notes.txt"))).toBe(true);
  });

  test("refuses a non-empty directory without index.json", async () => {
    const dir = setup();
    mkdirSync(join(dir, "docs/api"), { recursive: true });
    writeFileSync(join(dir, "docs/api/readme.md"), "mine");
    const result = await run(dir, ["--out", "docs/api"]);
    expect(result.code).toBe(1);
    expect(existsSync(join(dir, "docs/api/en"))).toBe(false);
  });

  test("loads apiDocs.translations lazily", async () => {
    const dir = setup(
      CONFIG.replace(
        'apiDocs: { baseUrl: "https://api.example.test", appName: "Helpdesk" }',
        'apiDocs: { baseUrl: "https://api.example.test", appName: "Helpdesk", locales: ["en", "de"], translations: async () => ({ "ticketing:write:ticket:close:description": { de: "Schließt ein Ticket." } }) }',
      ),
    );
    const result = await run(dir, ["--out", "docs/api"]);
    expect(result.code).toBe(0);
    const index = JSON.parse(readFileSync(join(dir, "docs/api/index.json"), "utf8")) as {
      pages: { path: string; locale: string }[];
    };
    const germanPages = index.pages.filter((page) => page.locale === "de");
    expect(germanPages.length).toBeGreaterThan(0);
    expect(
      germanPages.some((page) =>
        readFileSync(join(dir, "docs/api", page.path), "utf8").includes("Schließt ein Ticket."),
      ),
    ).toBe(true);
    expect(
      result.lines.some((line) =>
        line.includes("descriptionTranslationMissing] ticketing:write:ticket:close"),
      ),
    ).toBe(false);
  });

  test("a failing apiDocs.translations is reported", async () => {
    const dir = setup(
      CONFIG.replace(
        'apiDocs: { baseUrl: "https://api.example.test", appName: "Helpdesk" }',
        'apiDocs: { baseUrl: "https://api.example.test", appName: "Helpdesk", translations: async () => { throw new Error("texts missing"); } }',
      ),
    );
    const result = await run(dir, ["--out", "docs/api"]);
    expect(result.code).toBe(1);
    expect(result.lines.some((line) => line.includes("apiDocs.translations: texts missing"))).toBe(
      true,
    );
  });

  test("rejects unsupported locales and invalid recordings", async () => {
    const dir = setup();
    expect((await run(dir, ["--locales", "xx"])).code).toBe(2);
    mkdirSync(join(dir, "api-examples"));
    writeFileSync(join(dir, "api-examples/broken.json"), "{}");
    const result = await run(dir, ["--out", "docs/api"]);
    expect(result.code).toBe(1);
    expect(result.lines.join("\n")).toContain("broken.json");
  });
});
