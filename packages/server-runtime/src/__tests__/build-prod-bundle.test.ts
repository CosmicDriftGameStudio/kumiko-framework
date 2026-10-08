// Tests for build-prod-bundle: pure helpers (discovery, HTML injection, build id)
// plus the kumiko.assets copy step, which runs buildProdBundle itself against a
// minimal temp app (no client entries, stylesheet: false).
//
// The full Bun.build + Tailwind pipeline is not exercised here; CI covers it
// with `bun run build` on the showcase app, the more honest smoke test.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildProdBundle,
  type ClientEntry,
  type ClientEntryDeclaration,
  computeBuildId,
  discoverHtmlTemplate,
  formatBuildResult,
  injectAssetTags,
  isEntryOutputFor,
  readClientEntriesConfig,
  resolveClientEntries,
} from "../build-prod-bundle.js";
import { BUNDLED_ASSETS_DIST_DIR } from "../bundled-assets.js";

// Synthetic single-entry: injectAssetTags only needs the shape, not a
// resolveClientEntries round-trip.
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

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(value));
}

describe("build-prod-bundle/discovery (convention mode)", () => {
  let workDir = "";

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "kumiko-build-test-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  test("resolveClientEntries findet single-mode src/client.tsx wenn nichts deklariert ist", async () => {
    await mkdir(join(workDir, "src"), { recursive: true });
    await writeFile(join(workDir, "src/client.tsx"), "// single");

    const entries = resolveClientEntries(workDir, {});

    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe("client");
    expect(entries[0]?.manifestKey).toBe("client.js");
    expect(entries[0]?.htmlPath).toBe("index.html");
  });

  test("resolveClientEntries gibt leeres Array zurück wenn nichts da und nichts deklariert ist", () => {
    expect(resolveClientEntries(workDir, {})).toEqual([]);
  });

  // #2305 regression: a plain module imported by the real entry, named
  // like a legacy client-<suffix>.tsx file, must not turn into an error or
  // a second entry once src/client.tsx exists (single mode wins outright).
  test("src/client.tsx neben src/client-utils.tsx → genau ein Entry, kein Fehler", async () => {
    await mkdir(join(workDir, "src"), { recursive: true });
    await writeFile(join(workDir, "src/client.tsx"), "// real entry");
    await writeFile(join(workDir, "src/client-utils.tsx"), "export const utils = [];");

    const entries = resolveClientEntries(workDir, {});

    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe("client");
  });

  test("legacy src/client-<suffix>.tsx ohne Deklaration → Migrations-Fehler mit package.json-Snippet", async () => {
    await mkdir(join(workDir, "src"), { recursive: true });
    await writeFile(join(workDir, "src/client-admin.tsx"), "// admin");
    await writeFile(join(workDir, "src/client-public.tsx"), "// public");

    expect(() => resolveClientEntries(workDir, {})).toThrow(/client-admin\.tsx/);
    expect(() => resolveClientEntries(workDir, {})).toThrow(/client-public\.tsx/);
    expect(() => resolveClientEntries(workDir, {})).toThrow(/kumiko\.clientEntries/);
    expect(() => resolveClientEntries(workDir, {})).toThrow(
      /"name":\s*"admin",\s*"sourceFile":\s*"\.\/src\/client-admin\.tsx"/,
    );
  });

  test("legacy src/client-<suffix>.ts (kein x) → Migrations-Snippet nennt die exakte .ts-Extension", async () => {
    await mkdir(join(workDir, "src"), { recursive: true });
    await writeFile(join(workDir, "src/client-admin.ts"), "// admin");

    expect(() => resolveClientEntries(workDir, {})).toThrow(/src\/client-admin\.ts\b/);
    expect(() => resolveClientEntries(workDir, {})).toThrow(
      /"sourceFile":\s*"\.\/src\/client-admin\.ts"/,
    );
    expect(() => resolveClientEntries(workDir, {})).not.toThrow(/client-admin\.tsx/);
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

describe("build-prod-bundle/resolveClientEntries (declared)", () => {
  let workDir = "";

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "kumiko-build-declared-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  async function writeSourceFiles(names: readonly string[]): Promise<void> {
    await mkdir(join(workDir, "src"), { recursive: true });
    for (const name of names) {
      await writeFile(join(workDir, `src/${name}`), `// ${name}`);
    }
  }

  test("clientEntry → single entry named 'client'", async () => {
    await writeSourceFiles(["main.tsx"]);

    const entries = resolveClientEntries(workDir, { clientEntry: "./src/main.tsx" });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe("client");
    expect(entries[0]?.manifestKey).toBe("client.js");
    expect(entries[0]?.sourceFile).toBe(join(workDir, "src/main.tsx"));
    expect(entries[0]?.htmlPath).toBe("index.html");
  });

  test("clientEntry: sourceFile fehlt → throws", () => {
    expect(() => resolveClientEntries(workDir, { clientEntry: "./src/missing.tsx" })).toThrow(
      /kumiko\.clientEntry.*does not exist/s,
    );
  });

  test("clientEntry with non-source extension throws even when the file exists", async () => {
    await writeSourceFiles(["app.json"]);

    expect(() => resolveClientEntries(workDir, { clientEntry: "./src/app.json" })).toThrow(
      /kumiko\.clientEntry "\.\/src\/app\.json" must point to a \.ts, \.tsx, \.js or \.jsx file/,
    );
  });

  test("clientEntry und clientEntries gleichzeitig → mutual-exclusion error", async () => {
    await writeSourceFiles(["main.tsx", "client-admin.tsx"]);

    expect(() =>
      resolveClientEntries(workDir, {
        clientEntry: "./src/main.tsx",
        clientEntries: [{ name: "admin", sourceFile: "./src/client-admin.tsx" }],
      }),
    ).toThrow(/mutually exclusive/);
  });

  test("clientEntries: leeres Array → throws", () => {
    expect(() => resolveClientEntries(workDir, { clientEntries: [] })).toThrow(
      /"kumiko\.clientEntries" is empty/,
    );
  });

  test("clientEntries: ungültiger name (führender Großbuchstabe) → throws", async () => {
    await writeSourceFiles(["client-admin.tsx"]);

    expect(() =>
      resolveClientEntries(workDir, {
        clientEntries: [{ name: "Admin", sourceFile: "./src/client-admin.tsx" }],
      }),
    ).toThrow(/invalid "kumiko\.clientEntries\[\]\.name"/);
  });

  test("clientEntries: name mit '..' → throws", async () => {
    await writeSourceFiles(["client-admin.tsx"]);

    expect(() =>
      resolveClientEntries(workDir, {
        clientEntries: [{ name: "../x", sourceFile: "./src/client-admin.tsx" }],
      }),
    ).toThrow(/invalid "kumiko\.clientEntries\[\]\.name"/);
  });

  test("clientEntries: sourceFile escaping cwd via '..' → throws", () => {
    expect(() =>
      resolveClientEntries(workDir, {
        clientEntries: [{ name: "admin", sourceFile: "../outside.tsx" }],
      }),
    ).toThrow(/resolves outside the app root/);
  });

  test("clientEntries: absolute sourceFile outside cwd → throws", () => {
    expect(() =>
      resolveClientEntries(workDir, {
        clientEntries: [{ name: "admin", sourceFile: "/etc/passwd" }],
      }),
    ).toThrow(/resolves outside the app root/);
  });

  test("clientEntries: htmlPath escaping cwd → throws", async () => {
    await writeSourceFiles(["client-admin.tsx"]);

    expect(() =>
      resolveClientEntries(workDir, {
        clientEntries: [
          { name: "admin", sourceFile: "./src/client-admin.tsx", htmlPath: "../outside.html" },
        ],
      }),
    ).toThrow(/resolves outside the app root/);
  });

  test("clientEntries: sourceFile existiert nicht → throws", () => {
    expect(() =>
      resolveClientEntries(workDir, {
        clientEntries: [{ name: "admin", sourceFile: "./src/client-admin.tsx" }],
      }),
    ).toThrow(/sourceFile ".*" does not exist/);
  });

  test("clientEntries: sourceFile with non-source extension throws even when the file exists", async () => {
    await writeSourceFiles(["client-admin.css"]);

    expect(() =>
      resolveClientEntries(workDir, {
        clientEntries: [{ name: "admin", sourceFile: "./src/client-admin.css" }],
      }),
    ).toThrow(
      /kumiko\.clientEntries\["admin"\]\.sourceFile "\.\/src\/client-admin\.css" must point to a \.ts, \.tsx, \.js or \.jsx file/,
    );
  });

  test("clientEntries: htmlPath with non-html extension throws", async () => {
    await writeSourceFiles(["client-admin.tsx"]);

    expect(() =>
      resolveClientEntries(workDir, {
        clientEntries: [
          {
            name: "admin",
            sourceFile: "./src/client-admin.tsx",
            htmlPath: "./public/manifest.json",
          },
        ],
      }),
    ).toThrow(
      /kumiko\.clientEntries\["admin"\]\.htmlPath "\.\/public\/manifest\.json" must point to an \.html file/,
    );
  });

  test("clientEntries: doppelter name → throws", async () => {
    await writeSourceFiles(["client-admin.tsx", "client-admin2.tsx"]);

    expect(() =>
      resolveClientEntries(workDir, {
        clientEntries: [
          { name: "admin", sourceFile: "./src/client-admin.tsx" },
          { name: "admin", sourceFile: "./src/client-admin2.tsx" },
        ],
      }),
    ).toThrow(/duplicate "kumiko\.clientEntries\[\]\.name" "admin"/);
  });

  test("clientEntries: zwei Entries mit gleichem html-basename (default 'public' vs. explizit) → throws", async () => {
    await writeSourceFiles(["client-public.tsx", "client-legacy.tsx"]);

    expect(() =>
      resolveClientEntries(workDir, {
        clientEntries: [
          { name: "public", sourceFile: "./src/client-public.tsx" },
          { name: "legacy", sourceFile: "./src/client-legacy.tsx", htmlPath: "./index.html" },
        ],
      }),
    ).toThrow(/resolve to the same HTML output file "index\.html"/);
  });

  test("clientEntries: zwei Entries mit identischem source-basename → throws", async () => {
    await mkdir(join(workDir, "src/admin"), { recursive: true });
    await mkdir(join(workDir, "src/public"), { recursive: true });
    await writeFile(join(workDir, "src/admin/index.tsx"), "// admin");
    await writeFile(join(workDir, "src/public/index.tsx"), "// public");

    expect(() =>
      resolveClientEntries(workDir, {
        clientEntries: [
          { name: "admin", sourceFile: "./src/admin/index.tsx", htmlPath: "./admin.html" },
          { name: "public", sourceFile: "./src/public/index.tsx" },
        ],
      }),
    ).toThrow(/share the source basename "index"/);
  });

  test("publicstatus-Shape: public ohne htmlPath, admin/auth mit explizitem htmlPath", async () => {
    await mkdir(join(workDir, "public"), { recursive: true });
    await writeFile(join(workDir, "public/admin.html"), "<html></html>");
    await writeFile(join(workDir, "public/auth.html"), "<html></html>");
    await writeSourceFiles(["client-public.tsx", "client-admin.tsx", "client-auth.tsx"]);

    const entries = resolveClientEntries(workDir, {
      clientEntries: [
        { name: "public", sourceFile: "./src/client-public.tsx" },
        { name: "admin", sourceFile: "./src/client-admin.tsx", htmlPath: "./public/admin.html" },
        { name: "auth", sourceFile: "./src/client-auth.tsx", htmlPath: "./public/auth.html" },
      ],
    });

    expect(entries.map((e) => e.name)).toEqual(["admin", "auth", "public"]);
    const publicEntry = entries.find((e) => e.name === "public");
    expect(publicEntry?.manifestKey).toBe("client-public.js");
    expect(publicEntry?.htmlPath).toBe("index.html");
    const admin = entries.find((e) => e.name === "admin");
    expect(admin?.manifestKey).toBe("client-admin.js");
    expect(admin?.htmlPath).toBe(join(workDir, "public/admin.html"));
    const auth = entries.find((e) => e.name === "auth");
    expect(auth?.htmlPath).toBe(join(workDir, "public/auth.html"));
  });

  test("show-pony-Shape: admin und public beide mit explizitem htmlPath", async () => {
    await mkdir(join(workDir, "public"), { recursive: true });
    await writeFile(join(workDir, "public/admin.html"), "<html></html>");
    await writeFile(join(workDir, "public/index.html"), "<html></html>");
    await writeSourceFiles(["client-admin.tsx", "client-public.tsx"]);

    const entries = resolveClientEntries(workDir, {
      clientEntries: [
        { name: "admin", sourceFile: "./src/client-admin.tsx", htmlPath: "./public/admin.html" },
        { name: "public", sourceFile: "./src/client-public.tsx", htmlPath: "./public/index.html" },
      ],
    });

    expect(entries.map((e) => e.manifestKey)).toEqual(["client-admin.js", "client-public.js"]);
    expect(entries.map((e) => e.htmlPath)).toEqual([
      join(workDir, "public/admin.html"),
      join(workDir, "public/index.html"),
    ]);
  });

  test("offlot-app-Shape: einziger Entry 'app' mit explizitem htmlPath", async () => {
    await mkdir(join(workDir, "public"), { recursive: true });
    await writeFile(join(workDir, "public/app.html"), "<html></html>");
    await writeSourceFiles(["client-app.tsx"]);

    const entries = resolveClientEntries(workDir, {
      clientEntries: [
        { name: "app", sourceFile: "./src/client-app.tsx", htmlPath: "./public/app.html" },
      ],
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.manifestKey).toBe("client-app.js");
    expect(entries[0]?.htmlPath).toBe(join(workDir, "public/app.html"));
  });
});

describe("build-prod-bundle/readClientEntriesConfig", () => {
  let workDir = "";

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "kumiko-build-config-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  test("kein package.json → {}", () => {
    expect(readClientEntriesConfig(workDir)).toEqual({});
  });

  test("package.json ohne kumiko-Block → {}", async () => {
    await writeJson(join(workDir, "package.json"), { name: "app" });

    expect(readClientEntriesConfig(workDir)).toEqual({});
  });

  test("valides kumiko.clientEntry", async () => {
    await writeJson(join(workDir, "package.json"), {
      name: "app",
      kumiko: { clientEntry: "./src/client.tsx" },
    });

    expect(readClientEntriesConfig(workDir)).toEqual({ clientEntry: "./src/client.tsx" });
  });

  test("valides kumiko.clientEntries", async () => {
    const declared: readonly ClientEntryDeclaration[] = [
      { name: "public", sourceFile: "./src/client-public.tsx" },
      { name: "admin", sourceFile: "./src/client-admin.tsx", htmlPath: "./public/admin.html" },
    ];
    await writeJson(join(workDir, "package.json"), {
      name: "app",
      kumiko: { clientEntries: declared },
    });

    expect(readClientEntriesConfig(workDir)).toEqual({ clientEntries: declared });
  });

  test("kumiko.clientEntry ist keine string → throws", async () => {
    await writeJson(join(workDir, "package.json"), { name: "app", kumiko: { clientEntry: 42 } });

    expect(() => readClientEntriesConfig(workDir)).toThrow(
      /"kumiko\.clientEntry" must be a string/,
    );
  });

  test("kumiko.clientEntries ist kein Array → throws", async () => {
    await writeJson(join(workDir, "package.json"), {
      name: "app",
      kumiko: { clientEntries: { name: "admin" } },
    });

    expect(() => readClientEntriesConfig(workDir)).toThrow(
      /"kumiko\.clientEntries" must be an array/,
    );
  });

  test("kumiko.clientEntries[] ohne sourceFile → throws", async () => {
    await writeJson(join(workDir, "package.json"), {
      name: "app",
      kumiko: { clientEntries: [{ name: "admin" }] },
    });

    expect(() => readClientEntriesConfig(workDir)).toThrow(
      /"kumiko\.clientEntries\[0\]\.sourceFile" must be a non-empty string/,
    );
  });

  test("kumiko.clientEntries[].htmlPath ist keine string → throws", async () => {
    await writeJson(join(workDir, "package.json"), {
      name: "app",
      kumiko: {
        clientEntries: [{ name: "admin", sourceFile: "./src/client-admin.tsx", htmlPath: 1 }],
      },
    });

    expect(() => readClientEntriesConfig(workDir)).toThrow(
      /"kumiko\.clientEntries\[0\]\.htmlPath" must be a string/,
    );
  });

  test("kaputtes JSON → throws", async () => {
    await writeFile(join(workDir, "package.json"), "{not json");

    expect(() => readClientEntriesConfig(workDir)).toThrow(/Invalid JSON/);
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

describe("build-prod-bundle/computeBuildId", () => {
  test("identisches Manifest → gleiche id", () => {
    const manifest = {
      "client.js": "/assets/client-abc.js",
      "styles.css": "/assets/styles-xyz.css",
    };
    expect(computeBuildId(manifest)).toBe(computeBuildId({ ...manifest }));
  });

  test("Key-Reihenfolge egal — nur die URL-Werte zählen", () => {
    const a = { "client.js": "/assets/client-abc.js", "styles.css": "/assets/styles-xyz.css" };
    const b = { "styles.css": "/assets/styles-xyz.css", "client.js": "/assets/client-abc.js" };
    expect(computeBuildId(a)).toBe(computeBuildId(b));
  });

  test("geändertes Asset (neuer Hash) → andere id", () => {
    const before = { "client.js": "/assets/client-abc.js" };
    const after = { "client.js": "/assets/client-def.js" };
    expect(computeBuildId(before)).not.toBe(computeBuildId(after));
  });

  test("12 Hex-Zeichen", () => {
    expect(computeBuildId({ "client.js": "/assets/client-abc.js" })).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("build-prod-bundle/injectAssetTags build-info", () => {
  test("bäckt kumiko-build meta vor </head> wenn buildInfo gesetzt, ohne Inline-Script", () => {
    const html = `<html><head><title>x</title></head><body><script type="module" src="/client.js"></script></body></html>`;
    const result = injectAssetTags(html, { "client.js": "/assets/client-abc.js" }, clientEntry(), {
      id: "deadbeef0000",
      builtAt: "2026-06-18T12:00:00.000Z",
    });

    expect(result).toContain(
      '<meta name="kumiko-build" content="deadbeef0000" data-built-at="2026-06-18T12:00:00.000Z" />',
    );
    expect(result.indexOf("kumiko-build")).toBeLessThan(result.indexOf("</head>"));
    expect(result).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
  });

  test("escaped build-info values in the meta attributes", () => {
    const html = `<html><head></head><body><script type="module" src="/client.js"></script></body></html>`;
    const result = injectAssetTags(html, { "client.js": "/assets/client-abc.js" }, clientEntry(), {
      id: 'x"><script>alert(1)</script>',
      builtAt: "a&b",
    });

    expect(result).not.toContain("<script>alert");
    expect(result).toContain('content="x&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"');
    expect(result).toContain('data-built-at="a&amp;b"');
  });

  test("ohne buildInfo kein kumiko-build meta", () => {
    const html = `<html><head></head><body><script type="module" src="/client.js"></script></body></html>`;
    const result = injectAssetTags(html, { "client.js": "/assets/client-abc.js" }, clientEntry());

    expect(result).not.toContain("kumiko-build");
  });
});

describe("build-prod-bundle/formatBuildResult", () => {
  test("lists outDir, duration, and every manifest entry", () => {
    const out = formatBuildResult(
      {
        outDir: "dist",
        manifest: {
          "client.js": "/assets/client-abc.js",
          "styles.css": "/assets/styles-xyz.css",
        },
      },
      42,
    );
    expect(out).toContain("dist");
    expect(out).toContain("42ms");
    expect(out).toContain("client.js");
    expect(out).toContain("/assets/client-abc.js");
    expect(out).toContain("styles.css");
    expect(out).toContain("/assets/styles-xyz.css");
  });

  test("empty manifest still prints the success line", () => {
    const out = formatBuildResult({ outDir: "dist-server", manifest: {} }, 1);
    expect(out).toContain("dist-server");
    expect(out).toContain("1ms");
  });
});

describe("build-prod-bundle/discovery edges", () => {
  let workDir = "";

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "kumiko-build-edge-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  test("resolveClientEntries accepts src/client.ts (no x)", async () => {
    await mkdir(join(workDir, "src"), { recursive: true });
    await writeFile(join(workDir, "src/client.ts"), "// single ts");
    const entries = resolveClientEntries(workDir, {});
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe("client");
    expect(entries[0]?.sourceFile.endsWith("src/client.ts")).toBe(true);
  });

  test("resolveClientEntries ignores non-matching legacy client-* names (no migration error)", async () => {
    await mkdir(join(workDir, "src"), { recursive: true });
    // Uppercase / leading digit / underscore violate ^client-([a-z][a-z0-9-]*)\.tsx?$
    await writeFile(join(workDir, "src/client-Admin.tsx"), "// bad");
    await writeFile(join(workDir, "src/client-1bad.tsx"), "// bad");
    await writeFile(join(workDir, "src/client_admin.tsx"), "// bad");
    expect(resolveClientEntries(workDir, {})).toEqual([]);
  });
});

describe("buildProdBundle missing HTML template", () => {
  let workDir = "";

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "kumiko-build-missing-template-"));
    await mkdir(join(workDir, "src"), { recursive: true });
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  test("a multi-entry names its source file and the kumiko.clientEntries declaration", async () => {
    await writeFile(join(workDir, "src/client-features.tsx"), "export {};\n");
    const build = buildProdBundle({
      cwd: workDir,
      stylesheet: false,
      clientEntries: [{ name: "features", sourceFile: "./src/client-features.tsx" }],
    });

    await expect(build).rejects.toThrow(/src\/client-features\.tsx/);
    await expect(build).rejects.toThrow(/kumiko\.clientEntries/);
    await expect(build).rejects.toThrow(/Entry "features"/);
  });

  test("single-mode entry gets no declaration hint", async () => {
    await writeFile(join(workDir, "src/client.tsx"), "export {};\n");
    const build = buildProdBundle({
      cwd: workDir,
      stylesheet: false,
      clientEntry: "./src/client.tsx",
    });

    await expect(build).rejects.toThrow(/src\/client\.tsx/);
    await expect(build).rejects.not.toThrow(/kumiko\.clientEntries/);
  });
});

describe("build-prod-bundle/isEntryOutputFor", () => {
  test("matches only its own <base>-<hash>.js, not an entry whose base extends it", () => {
    expect(isEntryOutputFor("client-admin-a1B2c3.js", "client-admin")).toBe(true);
    expect(isEntryOutputFor("client-admin-legacy-a1B2c3.js", "client-admin")).toBe(false);
    expect(isEntryOutputFor("client-admin-legacy-a1B2c3.js", "client-admin-legacy")).toBe(true);
  });
});

describe("buildProdBundle bundled assets (kumiko.assets)", () => {
  let workDir = "";

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "kumiko-build-assets-"));
    await mkdir(join(workDir, "public"), { recursive: true });
    await writeFile(join(workDir, "public/index.html"), "<!doctype html>");
    await mkdir(join(workDir, "fonts"), { recursive: true });
    await writeFile(join(workDir, "fonts/inter-bold.ttf"), "ttf-bytes");
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  async function declare(assets: unknown): Promise<void> {
    await writeJson(join(workDir, "package.json"), { name: "assets-app", kumiko: { assets } });
  }

  test("copies each declared asset into the non-served dist dir", async () => {
    await declare([{ name: "inter-bold.ttf", source: "fonts/inter-bold.ttf" }]);
    await buildProdBundle({ cwd: workDir, stylesheet: false });
    const copied = join(workDir, "dist", BUNDLED_ASSETS_DIST_DIR, "inter-bold.ttf");
    expect(await readFile(copied, "utf8")).toBe("ttf-bytes");
  });

  test("a missing source file fails the build with the declared name", async () => {
    await declare([{ name: "gone.ttf", source: "fonts/gone.ttf" }]);
    await expect(buildProdBundle({ cwd: workDir, stylesheet: false })).rejects.toThrow(
      /"gone\.ttf": source file not found/,
    );
  });

  test("an invalid name fails the build", async () => {
    for (const name of ["../x.ttf", "a/b.ttf", "", ".hidden", "a..b"]) {
      await declare([{ name, source: "fonts/inter-bold.ttf" }]);
      await expect(buildProdBundle({ cwd: workDir, stylesheet: false })).rejects.toThrow(
        /invalid asset name|must be a string/,
      );
    }
  });

  test("duplicate names and a source escaping the package dir fail the build", async () => {
    await declare([
      { name: "a.ttf", source: "fonts/inter-bold.ttf" },
      { name: "a.ttf", source: "fonts/inter-bold.ttf" },
    ]);
    await expect(buildProdBundle({ cwd: workDir, stylesheet: false })).rejects.toThrow(/duplicate/);

    await declare([{ name: "a.ttf", source: "../outside.ttf" }]);
    await expect(buildProdBundle({ cwd: workDir, stylesheet: false })).rejects.toThrow(
      /escapes the package dir/,
    );

    await declare([{ name: "a.ttf", source: join(workDir, "fonts/inter-bold.ttf") }]);
    await expect(buildProdBundle({ cwd: workDir, stylesheet: false })).rejects.toThrow(
      /must be relative/,
    );
  });
});
