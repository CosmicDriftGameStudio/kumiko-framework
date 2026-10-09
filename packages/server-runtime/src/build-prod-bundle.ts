// buildProdBundle — Production-Build für Kumiko-Apps. Ein generischer
// Build-Step ohne App-spezifisches Wissen: Convention-Discovery liest
// die App-Struktur, Bun.build + Tailwind + Public-Folder-Copy
// produzieren ein deploybares dist/.
//
// Client entries (fw#2320 — explicit, no filename inference):
//
//   package.json "kumiko.clientEntries": [{ name, sourceFile, htmlPath? }]
//                                     →  one Bun.build bundle per declared entry
//   package.json "kumiko.clientEntry": "./src/…"
//                                     →  single bundle, name "client"
//   (neither declared)               →  convention: src/client.tsx | src/client.ts
//
// Convention for everything else (all optional, missing → skipped):
//
//   src/styles.css                   →  Tailwind one-shot
//                                       (oder fallback auf @cosmicdrift/kumiko-renderer-web/styles.css
//                                        wenn nur clientEntry da ist und kein eigenes CSS)
//   public/                          →  rsync 1:1 (kein Hash — User-bewusste URLs)
//   public/index.html | index.html   →  Template, Placeholder-Tags ersetzt:
//                                         <script type="module" src="/client.js"> → /assets/client-<hash>.js
//                                         <link href="/styles.css"> → /assets/styles-<hash>.css
//   (kein HTML, vanilla)             →  Default-HTML ohne Asset-Tags
//
// Fehler-Modus: hat client.tsx oder Tailwind etwas produziert, aber das HTML
// hat keinen passenden Placeholder, wirft der Build mit dem exakten Snippet
// zum Reinkopieren. Keine silent-injection — das HTML soll lesen wie's
// auch im Dev-Server liefert.
//
// Output:
//
//   dist/
//     index.html              ← Tags mit gehashten URLs
//     assets/
//       client-<hash>.js      ← entry
//       <chunk>-<hash>.js     ← split chunks
//       styles-<hash>.css     ← Tailwind output
//       <asset>-<hash>.<ext>  ← imported file-loader assets
//     kumiko-bundled-assets/  ← package.json "kumiko.assets", never served over HTTP
//     manifest.json           ← logical → hashed-URL mapping
//     <public/* 1:1>          ← favicon.ico, robots.txt, og-image.png, …
//
// Cache-Header (von runProdApp gesetzt, nicht hier):
//
//   /assets/*               →  public, max-age=31536000, immutable
//   /index.html, /sw.js     →  no-cache, must-revalidate
//   /manifest.json          →  no-cache
//   alles andere (public/)  →  default (auto-cache)

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isPlainObject, parseJsonOrThrow } from "@cosmicdrift/kumiko-framework/utils";
import { escapeHtmlAttr } from "@cosmicdrift/kumiko-headless";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import {
  BUNDLED_ASSETS_DIST_DIR,
  type BundledAssetDeclaration,
  readBundledAssetDeclarations,
  resolveBundledAssetSource,
} from "./bundled-assets.js";
import {
  RENDERER_WEB_FONT_FILE_PATTERN,
  RENDERER_WEB_FONTS_DIST_DIR,
  resolveRendererWebFontsDir,
} from "./renderer-web-fonts.js";
import { canResolveTailwindStylesheet, resolveTailwindCli } from "./resolve-tailwind-cli.js";

// Bun-Runtime-Check als module-level Konstante: alle Build-Schritte
// (Tailwind via Bun.spawn, Client-Bundle via Bun.build, Stylesheet-
// Resolution via Bun.resolveSync) sind Bun-only. Pro-Funktions-Inline-
// Checks driften sonst — eine Konstante hier hält das konsistent.
const hasBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

export type BuildProdBundleOptions = {
  /** App-Root. Default: process.cwd(). */
  readonly cwd?: string;
  /** Output-Folder relativ zu cwd. Default: "dist". */
  readonly outDir?: string;
  /** Stylesheet-Override. Default: erst src/styles.css, dann
   *  @cosmicdrift/kumiko-renderer-web/styles.css wenn clientEntry da ist.
   *  `false` deaktiviert die CSS-Pipeline explizit. */
  readonly stylesheet?: string | false;
} & ClientEntriesConfig;

/** One declared client entry, read from package.json `kumiko.clientEntries`.
 *  `name` becomes the output filename (`client-<name>.js` / `<name>.html`
 *  unless `htmlPath` overrides it). */
export type ClientEntryDeclaration = {
  readonly name: string;
  readonly sourceFile: string;
  readonly htmlPath?: string;
};

/** The two mutually exclusive shapes read from package.json `kumiko.*`.
 *  Neither set → convention mode (src/client.tsx | src/client.ts). */
export type ClientEntriesConfig = {
  readonly clientEntry?: string;
  readonly clientEntries?: readonly ClientEntryDeclaration[];
};

export type BuildManifest = Readonly<Record<string, string>>;

export type BuildResult = {
  readonly outDir: string;
  /** Logical → hashed-URL mapping. Beispiel:
   *    { "client.js": "/assets/client-a3f2.js",
   *      "styles.css": "/assets/styles-9b4c.css" } */
  readonly manifest: BuildManifest;
  /** Build-Identität (Hash über die Asset-URLs) + lesbarer Zeitstempel.
   *  undefined bei vanilla public-only-Builds (kein Bundle). */
  readonly buildInfo?: BuildInfo;
};

/** Baked into index.html (`<meta name="kumiko-build">`) AND written as
 *  dist/build-info.json. The UpdateChecker polls build-info.json and compares
 *  `id` with the loaded build, showing a reload banner on drift. */
export type BuildInfo = {
  /** Hash über die sortierten (content-gehashten) Asset-URLs. Ändert sich
   *  gdw. sich ein Asset ändert — selbsttragend, kein Env-Var/Dockerfile. */
  readonly id: string;
  /** ISO-Zeitstempel des Builds, lesbare Anzeige-Version (ersetzt den rohen sha). */
  readonly builtAt: string;
};

// Default-HTML wird nur genutzt wenn der App-Author KEIN index.html liefert.
// Hat keine Asset-Placeholder, weil der Default-Pfad für vanilla apps
// (nur public/) gedacht ist — wer JS/CSS will, schreibt ein eigenes
// index.html mit den richtigen Placeholder-Tags.
// interactive-widget=resizes-content (fw#1918): keeps `position: fixed`
// bottom bars anchored above a mobile keyboard instead of behind it. iOS Safari
// ignores the key; renderer-web's useKeyboardInset covers it via window.visualViewport.
export const DEFAULT_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1,interactive-widget=resizes-content" />
    <title>Kumiko</title>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

/** Folder name relative to dist/ for hashed assets (JS, CSS, file-loader
 *  outputs). Exported damit runProdApp dieselbe Konvention für Cache-
 *  Header nutzt — Drift verhindern. */
export const ASSETS_DIR = "assets";

const ASSET_LOADERS = {
  ".png": "file",
  ".jpg": "file",
  ".jpeg": "file",
  ".gif": "file",
  ".svg": "file",
  ".webp": "file",
  ".ico": "file",
  ".woff": "file",
  ".woff2": "file",
  ".ttf": "file",
  ".otf": "file",
} as const;

export async function buildProdBundle(options: BuildProdBundleOptions = {}): Promise<BuildResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const outDir = resolve(cwd, options.outDir ?? "dist");
  const assetsDir = join(outDir, ASSETS_DIR);

  // 1. Discovery: was ist da?
  const clientEntries = resolveClientEntries(cwd, options);
  const firstClientSource = clientEntries[0]?.sourceFile;
  const stylesheet = resolveStylesheetEntry(cwd, firstClientSource, options.stylesheet);
  const publicDir = resolve(cwd, "public");
  const hasPublicDir = existsSync(publicDir);
  // Validated before the clean step so a bad declaration cannot leave a wiped dist/.
  const bundledAssets = readBundledAssetDeclarations(cwd);

  if (clientEntries.length === 0 && !hasPublicDir) {
    throw new Error(
      `[kumiko build] nothing to build in ${cwd} — expected one of: ` +
        `package.json "kumiko.clientEntry"/"kumiko.clientEntries", src/client.tsx, public/`,
    );
  }

  // 2. Clean + scaffold
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await mkdir(assetsDir, { recursive: true });

  const manifest: Record<string, string> = {};

  // 3. Tailwind one-shot (vor JS, weil JS' loader auf .css trifft falls
  //    der client.tsx ein "import './foo.css'" macht — den Fall lassen
  //    wir hier raus, Tailwind ist die einzige CSS-Quelle).
  if (stylesheet) {
    const css = await runTailwindOnce(stylesheet.path, cwd);
    assertRendererWebShellPresent(css, stylesheet);
    const hash = shortHash(css);
    const filename = `styles-${hash}.css`;
    await writeFile(join(assetsDir, filename), css);
    manifest["styles.css"] = `/${ASSETS_DIR}/${filename}`;
    await copyRendererWebFonts(cwd, outDir);
  }

  // 4. Bun.build pro Entry (multi-entry produces N bundles + shared chunks).
  //    Ein einzelner Bun.build-Call mit allen entrypoints würde shared
  //    chunks deduplizieren, hashes deterministisch halten — passt zu
  //    dem split-tree-Pattern von publicstatus (admin + public teilen
  //    sich den renderer-web-core).
  if (clientEntries.length > 0) {
    const built = await buildClientBundles(clientEntries, assetsDir);
    for (const [manifestKey, filename] of Object.entries(built)) {
      manifest[manifestKey] = `/${ASSETS_DIR}/${filename}`;
    }
  }

  // 5. Public-Folder rsync (ohne index.html / *.html-templates — werden
  //    separat gerendert). Filter-list = template-basenames der entries.
  const templateBasenames = new Set<string>(clientEntries.map((e) => basenameOf(e.htmlPath)));
  if (hasPublicDir) {
    await copyPublicFolder(publicDir, outDir, templateBasenames);
  }

  // 5a. Declared read-only assets (package.json "kumiko.assets"), copied after
  //     public/ so a same-named public file cannot shadow them.
  await copyBundledAssets(cwd, outDir, bundledAssets);

  // 5b. Build-Identität: Hash über die content-gehashten Asset-URLs +
  //     lesbarer Zeitstempel. Wird in index.html gebacken und als
  //     build-info.json geschrieben (Update-Awareness, default an).
  //     ponytail: id hängt nur an Assets — ein reiner Server-Deploy ohne
  //     Client-Bundle-Change behält die id → kein Banner (die UI ist dann
  //     nicht stale). Bei Bedarf an Server-Versionierung koppeln.
  const buildInfo: BuildInfo | undefined =
    Object.keys(manifest).length > 0
      ? { id: computeBuildId(manifest), builtAt: Temporal.Now.instant().toString() }
      : undefined;

  // 6. HTML pro Entry rendern. Convention: ein HTML-File pro Client-Entry,
  //    jede mit ihrem eigenen Script-Tag. Server (runProdApp.hostDispatch)
  //    serviert je nach Host das passende File.
  if (clientEntries.length === 0) {
    // Vanilla-public-only-app: keine HTML-Files zu rendern, public-Folder
    // wurde schon kopiert.
  } else {
    for (const entry of clientEntries) {
      const templatePath = resolve(cwd, entry.htmlPath);
      const templateExists = existsSync(templatePath);
      const html = await renderHtml(
        templateExists ? templatePath : undefined,
        manifest,
        entry,
        buildInfo,
      );
      const outFile = basenameOf(entry.htmlPath);
      await writeFile(join(outDir, outFile), html);
    }
  }

  // 7. Manifest + Build-Info.
  await writeFile(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  if (buildInfo) {
    await writeFile(join(outDir, "build-info.json"), `${JSON.stringify(buildInfo)}\n`);
  }

  return { outDir, manifest, ...(buildInfo && { buildInfo }) };
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

// Single client-entry shape — one bundle, one html-template.
export type ClientEntry = {
  /** Logical name. "client" for single-entry mode (package.json
   *  `kumiko.clientEntry` or the src/client.tsx convention); otherwise the
   *  `name` declared in package.json `kumiko.clientEntries[]`. */
  readonly name: string;
  /** Absolute path to the TypeScript entry module. */
  readonly sourceFile: string;
  /** Manifest key & logical asset path. "client.js" for single-entry mode,
   *  otherwise "client-<name>.js". */
  readonly manifestKey: string;
  /** HTML template path — absolute when declared or discovered on disk,
   *  otherwise a bare default filename ("index.html", "<name>.html")
   *  resolved against cwd by the caller. Naming is deliberately symmetric
   *  to `runDevApp.clientEntries[].htmlPath` so build and dev server agree
   *  on the same convention. */
  readonly htmlPath: string;
};

const ENTRY_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

// The extension guard and both basename derivations (collision check, Bun.build
// output mapping) must agree, otherwise an accepted entry maps to no bundle.
const SOURCE_EXTENSION_PATTERN = /\.(?:tsx?|jsx?)$/;

/** Resolves the client entries to build. Public — also called from
 *  `kumiko-build`/`kumiko build` via `@cosmicdrift/kumiko-dev-server/build`,
 *  not just from unit tests.
 *
 * Precedence (fw#2320 — explicit declaration, no filename inference):
 *   1. `declared.clientEntry` and `declared.clientEntries` both set → throw.
 *   2. `declared.clientEntries` (non-empty) → one entry per declaration.
 *   3. `declared.clientEntry` → single entry, name "client".
 *   4. Neither → convention: src/client.tsx | src/client.ts (name "client").
 *      If that convention finds nothing but src/ still has legacy
 *      `client-<suffix>.tsx` files, throws a migration error instead of
 *      silently shipping a build without their bundles. */
export function resolveClientEntries(
  cwd: string,
  declared: ClientEntriesConfig,
): readonly ClientEntry[] {
  const hasClientEntry = declared.clientEntry !== undefined;
  const hasClientEntries = declared.clientEntries !== undefined;
  if (hasClientEntry && hasClientEntries) {
    throw new Error(
      '[kumiko build] package.json "kumiko.clientEntry" and "kumiko.clientEntries" ' +
        "are mutually exclusive — declare only one.",
    );
  }
  if (declared.clientEntries !== undefined) {
    return resolveDeclaredMultiEntries(cwd, declared.clientEntries);
  }
  if (declared.clientEntry !== undefined) {
    return [resolveDeclaredSingleEntry(cwd, declared.clientEntry)];
  }
  return resolveConventionEntries(cwd);
}

function resolveDeclaredMultiEntries(
  cwd: string,
  declarations: readonly ClientEntryDeclaration[],
): readonly ClientEntry[] {
  if (declarations.length === 0) {
    throw new Error(
      '[kumiko build] package.json "kumiko.clientEntries" is empty — omit the key ' +
        "entirely to use the src/client.tsx convention.",
    );
  }
  const entries = declarations.map((decl) => resolveDeclaredEntry(cwd, decl));

  const seenNames = new Set<string>();
  for (const entry of entries) {
    if (seenNames.has(entry.name)) {
      throw new Error(
        `[kumiko build] duplicate "kumiko.clientEntries[].name" "${entry.name}" — names must be unique.`,
      );
    }
    seenNames.add(entry.name);
  }

  const seenHtmlBasenames = new Set<string>();
  for (const entry of entries) {
    const base = basenameOf(entry.htmlPath);
    if (seenHtmlBasenames.has(base)) {
      throw new Error(
        `[kumiko build] two "kumiko.clientEntries" entries resolve to the same HTML ` +
          `output file "${base}" — set an explicit "htmlPath" on one of them.`,
      );
    }
    seenHtmlBasenames.add(base);
  }

  // Bun.build's output → ClientEntry mapping (buildClientBundles) matches on
  // the source basename without extension. Two entries sharing it would
  // silently map to the same bundle.
  const seenSourceBasenames = new Set<string>();
  for (const entry of entries) {
    const base = basenameOf(entry.sourceFile).replace(SOURCE_EXTENSION_PATTERN, "");
    if (seenSourceBasenames.has(base)) {
      throw new Error(
        `[kumiko build] two "kumiko.clientEntries" entries share the source basename ` +
          `"${base}" ("${entry.sourceFile}") — rename one of the source files.`,
      );
    }
    seenSourceBasenames.add(base);
  }

  return [...entries].sort((a, b) => a.name.localeCompare(b.name));
}

function resolveDeclaredEntry(cwd: string, decl: ClientEntryDeclaration): ClientEntry {
  if (!ENTRY_NAME_PATTERN.test(decl.name)) {
    throw new Error(
      `[kumiko build] invalid "kumiko.clientEntries[].name" "${decl.name}" — must match ` +
        `^[a-z][a-z0-9-]*$ (it becomes the output filename client-${decl.name}.js).`,
    );
  }
  const sourceFile = resolveWithinCwd(
    cwd,
    decl.sourceFile,
    `kumiko.clientEntries["${decl.name}"].sourceFile`,
  );
  assertValidSourceExtension(decl.sourceFile, `kumiko.clientEntries["${decl.name}"].sourceFile`);
  if (!isExistingFile(sourceFile)) {
    throw new Error(
      `[kumiko build] kumiko.clientEntries["${decl.name}"].sourceFile "${decl.sourceFile}" ` +
        `does not exist (resolved: ${sourceFile}).`,
    );
  }
  const htmlPath =
    decl.htmlPath !== undefined
      ? resolveDeclaredHtmlPath(cwd, decl.name, decl.htmlPath)
      : decl.name === "public"
        ? (discoverHtmlTemplateFor(cwd, "index") ?? "index.html")
        : (discoverHtmlTemplateFor(cwd, decl.name) ?? `${decl.name}.html`);
  return { name: decl.name, sourceFile, manifestKey: `client-${decl.name}.js`, htmlPath };
}

function resolveDeclaredHtmlPath(cwd: string, entryName: string, htmlPath: string): string {
  const label = `kumiko.clientEntries["${entryName}"].htmlPath`;
  const resolved = resolveWithinCwd(cwd, htmlPath, label);
  assertValidHtmlExtension(htmlPath, label);
  return resolved;
}

function resolveDeclaredSingleEntry(cwd: string, clientEntry: string): ClientEntry {
  const sourceFile = resolveWithinCwd(cwd, clientEntry, "kumiko.clientEntry");
  assertValidSourceExtension(clientEntry, "kumiko.clientEntry");
  if (!isExistingFile(sourceFile)) {
    throw new Error(
      `[kumiko build] kumiko.clientEntry "${clientEntry}" does not exist (resolved: ${sourceFile}).`,
    );
  }
  return {
    name: "client",
    sourceFile,
    manifestKey: "client.js",
    htmlPath: discoverHtmlTemplateFor(cwd, "index") ?? "index.html",
  };
}

function resolveConventionEntries(cwd: string): readonly ClientEntry[] {
  for (const candidate of ["src/client.tsx", "src/client.ts"]) {
    const sourceFile = resolve(cwd, candidate);
    if (existsSync(sourceFile)) {
      return [
        {
          name: "client",
          sourceFile,
          manifestKey: "client.js",
          htmlPath: discoverHtmlTemplateFor(cwd, "index") ?? "index.html",
        },
      ];
    }
  }
  const legacyEntries = findLegacyClientFiles(cwd);
  if (legacyEntries.length > 0) {
    throw new Error(buildLegacyMultiEntryMigrationError(legacyEntries));
  }
  return [];
}

type LegacyClientFile = { readonly name: string; readonly file: string };

// Pre-fw#2320 multi-entry convention: any src/client-<suffix>.tsx(x) became
// its own bundle. Detecting these without a declaration means an unmigrated
// app would silently ship without their bundles — throw instead.
function findLegacyClientFiles(cwd: string): readonly LegacyClientFile[] {
  const srcDir = resolve(cwd, "src");
  if (!existsSync(srcDir)) return [];
  let files: readonly string[];
  try {
    files = readdirSync(srcDir);
  } catch {
    return [];
  }
  const found: LegacyClientFile[] = [];
  for (const file of files) {
    const match = /^client-([a-z][a-z0-9-]*)\.tsx?$/.exec(file);
    if (match?.[1]) found.push({ name: match[1], file });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

function buildLegacyMultiEntryMigrationError(entries: readonly LegacyClientFile[]): string {
  const fileNames = entries.map((e) => `src/${e.file}`).join(", ");
  const snippet = entries
    .map((e) => `      { "name": "${e.name}", "sourceFile": "./src/${e.file}" }`)
    .join(",\n");
  return (
    `[kumiko build] found ${fileNames} but no "kumiko.clientEntries" declaration in ` +
    `package.json — production builds no longer infer entries from filenames (fw#2320). Add:\n\n` +
    `  "kumiko": {\n` +
    `    "clientEntries": [\n` +
    `${snippet}\n` +
    `    ]\n` +
    `  }\n`
  );
}

function resolveWithinCwd(cwd: string, value: string, label: string): string {
  const resolved = resolve(cwd, value);
  const rel = relative(cwd, resolved);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`[kumiko build] ${label} "${value}" resolves outside the app root ${cwd}.`);
  }
  return resolved;
}

function isExistingFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

// The basename of htmlPath becomes a dist output filename (e.g. "manifest.json"
// would collide with a file the build writes itself) — restrict it to .html.
function assertValidHtmlExtension(value: string, label: string): void {
  if (!value.endsWith(".html")) {
    throw new Error(`[kumiko build] ${label} "${value}" must point to an .html file.`);
  }
}

function assertValidSourceExtension(value: string, label: string): void {
  if (!SOURCE_EXTENSION_PATTERN.test(value)) {
    throw new Error(
      `[kumiko build] ${label} "${value}" must point to a .ts, .tsx, .js or .jsx file.`,
    );
  }
}

/** Reads package.json → `kumiko.clientEntry` / `kumiko.clientEntries`.
 *  Missing file or missing keys → `{}` (falls back to convention mode). A
 *  malformed value under either key throws — a typo here must fail the
 *  build loudly instead of silently dropping declared entries. */
export function readClientEntriesConfig(cwd: string): ClientEntriesConfig {
  const pkgJsonPath = resolve(cwd, "package.json");
  if (!existsSync(pkgJsonPath)) return {};
  const raw = readFileSync(pkgJsonPath, "utf8");
  const parsed = parseJsonOrThrow<unknown>(raw, pkgJsonPath);
  if (!isPlainObject(parsed)) return {};
  const kumiko = parsed["kumiko"];
  if (!isPlainObject(kumiko)) return {};

  const result: { clientEntry?: string; clientEntries?: readonly ClientEntryDeclaration[] } = {};

  if ("clientEntry" in kumiko) {
    const value = kumiko["clientEntry"];
    if (typeof value !== "string") {
      throw new Error(
        `[kumiko build] package.json "kumiko.clientEntry" must be a string, got ${typeof value}.`,
      );
    }
    result.clientEntry = value;
  }

  if ("clientEntries" in kumiko) {
    const value = kumiko["clientEntries"];
    if (!Array.isArray(value)) {
      throw new Error(
        `[kumiko build] package.json "kumiko.clientEntries" must be an array, got ${typeof value}.`,
      );
    }
    result.clientEntries = value.map((item, index) => parseClientEntryDeclaration(item, index));
  }

  return result;
}

function parseClientEntryDeclaration(item: unknown, index: number): ClientEntryDeclaration {
  if (!isPlainObject(item)) {
    throw new Error(
      `[kumiko build] package.json "kumiko.clientEntries[${index}]" must be an object.`,
    );
  }
  const name = item["name"];
  const sourceFile = item["sourceFile"];
  const htmlPath = item["htmlPath"];
  if (typeof name !== "string" || name.length === 0) {
    throw new Error(
      `[kumiko build] package.json "kumiko.clientEntries[${index}].name" must be a non-empty string.`,
    );
  }
  if (typeof sourceFile !== "string" || sourceFile.length === 0) {
    throw new Error(
      `[kumiko build] package.json "kumiko.clientEntries[${index}].sourceFile" must be a non-empty string.`,
    );
  }
  if (htmlPath !== undefined && typeof htmlPath !== "string") {
    throw new Error(
      `[kumiko build] package.json "kumiko.clientEntries[${index}].htmlPath" must be a string when set.`,
    );
  }
  return { name, sourceFile, ...(htmlPath !== undefined && { htmlPath }) };
}

function discoverHtmlTemplateFor(cwd: string, basename: string): string | undefined {
  for (const candidate of [`${basename}.html`, `public/${basename}.html`]) {
    const path = resolve(cwd, candidate);
    if (existsSync(path)) return path;
  }
  return undefined;
}

type ResolvedStylesheet = {
  readonly path: string;
  /** True nur wenn wir auf das gepackte renderer-web-styles.css zurückfallen
   *  (App hat clientEntry + renderer-web-Dep, aber kein eigenes src/styles.css).
   *  Steuert den Shell-Klassen-Sentinel im Build. */
  readonly isRendererWebFallback: boolean;
};

// Äußerster Wrapper von DefaultAppShell/WorkspaceShell trägt diese Utility
// (app-layout.tsx: "flex min-h-screen …"). Echtes Tailwind-Utility (landet
// also im kompilierten Output) ohne CSS-Escaping → stabiler Substring-Sentinel.
const RENDERER_WEB_SHELL_SENTINEL = "min-h-screen";

function resolveStylesheetEntry(
  cwd: string,
  clientEntry: string | undefined,
  override: BuildProdBundleOptions["stylesheet"],
): ResolvedStylesheet | undefined {
  if (override === false) return undefined;
  if (typeof override === "string") {
    return { path: resolve(cwd, override), isRendererWebFallback: false };
  }

  // App-eigenes styles.css schlägt den Default.
  const local = resolve(cwd, "src/styles.css");
  if (existsSync(local)) return { path: local, isRendererWebFallback: false };

  // Sonst: nur wenn ein client da ist, fallback auf renderer-web/styles.css.
  // Sample-Apps und Showcases nutzen das alle — gleiche Logik wie der dev-
  // server, damit lokal/prod identisch bauen.
  if (!clientEntry) return undefined;

  if (!hasBun) return undefined;
  try {
    const resolved = (
      globalThis as { Bun: { resolveSync: (id: string, from: string) => string } }
    ).Bun.resolveSync("@cosmicdrift/kumiko-renderer-web/styles.css", cwd);
    const bun = (globalThis as { Bun: { resolveSync: (id: string, from: string) => string } }).Bun;
    if (!canResolveTailwindStylesheet(resolved, { bun, cwd })) {
      return undefined;
    }
    return { path: resolved, isRendererWebFallback: true };
  } catch {
    return undefined;
  }
}

// Build-Zeit-Guard gegen unstyled prod (#359): fällt der Build auf renderer-
// web/styles.css zurück und fehlt im kompilierten CSS die Shell-Sentinel-
// Klasse, wurden die DefaultAppShell-Styles nicht gescannt (renderer-web
// nicht dort installiert wo Tailwind scannt, oder ein @source-Regress).
// Laut failen statt ein 15KB-Image zu liefern, das in prod nackt rendert.
// @internal — exportiert nur für Unit-Tests.
export function assertRendererWebShellPresent(css: string, stylesheet: ResolvedStylesheet): void {
  // skip: not the renderer-web fallback stylesheet, invariant doesn't apply
  if (!stylesheet.isRendererWebFallback) return;
  // skip: shell sentinel class present, styles were scanned correctly
  if (css.includes(RENDERER_WEB_SHELL_SENTINEL)) return;
  throw new Error(
    `[kumiko build] renderer-web-Fallback-CSS ohne Shell-Klasse "${RENDERER_WEB_SHELL_SENTINEL}" — ` +
      "die DefaultAppShell/WorkspaceShell-Styles fehlen, prod würde unstyled rendern. Meist ist " +
      "@cosmicdrift/kumiko-renderer-web nicht dort installiert wo Tailwind seine Source scannt. " +
      'Fix: src/styles.css anlegen mit `@import "@cosmicdrift/kumiko-renderer-web/styles.css";` ' +
      '(+ `@source "./**/*.{ts,tsx}";` um auch eigene Komponenten zu scannen).',
  );
}

// The compiled CSS points at absolute /assets/kumiko/fonts/<file>.woff2 URLs
// (see renderer-web-fonts.ts), so the files have to sit at exactly that path in
// dist. Skipped when renderer-web isn't resolvable — then no such CSS exists.
async function copyRendererWebFonts(cwd: string, outDir: string): Promise<void> {
  const fontsDir = resolveRendererWebFontsDir([cwd]);
  // skip: renderer-web not resolvable, so no font-referencing CSS exists.
  if (fontsDir === undefined || !existsSync(fontsDir)) return;
  const target = join(outDir, RENDERER_WEB_FONTS_DIST_DIR);
  await mkdir(target, { recursive: true });
  for (const file of readdirSync(fontsDir)) {
    if (RENDERER_WEB_FONT_FILE_PATTERN.test(file)) {
      await cp(join(fontsDir, file), join(target, file));
    }
  }
}

// Fails the build on a missing source: a runtime readBundledAsset() miss in
// prod would otherwise only surface on the first request that needs the file.
async function copyBundledAssets(
  cwd: string,
  outDir: string,
  declarations: readonly BundledAssetDeclaration[],
): Promise<void> {
  const target = join(outDir, BUNDLED_ASSETS_DIST_DIR);
  for (const declaration of declarations) {
    const source = resolveBundledAssetSource(cwd, declaration);
    if (!existsSync(source) || !statSync(source).isFile()) {
      throw new Error(
        `[kumiko build] package.json "kumiko.assets" "${declaration.name}": source file not found ` +
          `at ${source} (declared as "${declaration.source}").`,
      );
    }
    await mkdir(target, { recursive: true });
    await cp(source, join(target, declaration.name));
  }
}

// @internal — exported nur für Unit-Tests.
export function discoverHtmlTemplate(cwd: string): string | undefined {
  for (const candidate of ["index.html", "public/index.html"]) {
    const path = resolve(cwd, candidate);
    if (existsSync(path)) return path;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Build steps
// ---------------------------------------------------------------------------

// @internal — exportiert nur für Unit-Tests (Relocation-Test des @source-Layouts).
export async function runTailwindOnce(entry: string, cwd: string): Promise<string> {
  if (!hasBun) {
    throw new Error(
      "[kumiko build] Tailwind one-shot requires Bun (Bun.spawn) — run via `bun run …` or `bun kumiko build`.",
    );
  }
  const bunResolver = (globalThis as { Bun: { resolveSync: (id: string, from: string) => string } })
    .Bun;
  const cliPath = resolveTailwindCli({ bun: bunResolver, cwd });
  if (cliPath === undefined) {
    throw new Error(
      "[kumiko build] @tailwindcss/cli nicht auflösbar — `bun install` im App-Root ausführen.",
    );
  }
  if (!canResolveTailwindStylesheet(entry, { bun: bunResolver, cwd })) {
    throw new Error(
      `[kumiko build] tailwindcss nicht auflösbar für ${entry} — peer dependency fehlt am Stylesheet-Ort.`,
    );
  }
  const { compile, optimize, Scanner } = await loadTailwindEngine(cliPath, bunResolver);
  const input = resolve(cwd, entry);
  if (!existsSync(input)) {
    throw new Error(`[kumiko build] tailwind: stylesheet not found: ${input}`);
  }
  const css = await readFile(input, "utf8");
  // Mirrors `@tailwindcss/cli -i <entry> -o <file> --minify` option for option, so the output
  // stays byte-identical to the CLI without spawning a child process.
  const compiler = await compile(css, {
    from: input,
    base: dirname(input),
    onDependency: () => {},
  });
  const rootSources =
    compiler.root === "none"
      ? []
      : compiler.root === null
        ? [{ base: resolve(cwd), pattern: "**/*", negated: false }]
        : [{ ...compiler.root, negated: false }];
  const scanner = new Scanner({
    sources: [
      ...rootSources,
      ...compiler.sources,
      { base: dirname(process.execPath), pattern: basename(process.execPath), negated: true },
    ],
  });
  return optimize(compiler.build(scanner.scan()), { file: input, minify: true }).code;
}

type TailwindSource = { base: string; pattern: string; negated: boolean };
type TailwindCompiler = {
  root: "none" | null | { base: string; pattern: string };
  sources: TailwindSource[];
  build: (candidates: string[]) => string;
};
type TailwindEngine = {
  compile: (
    css: string,
    opts: { from: string; base: string; onDependency: (path: string) => void },
  ) => Promise<TailwindCompiler>;
  optimize: (css: string, opts: { file: string; minify: boolean }) => { code: string };
  Scanner: new (opts: { sources: TailwindSource[] }) => { scan: () => string[] };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

type TailwindEngineCandidate = { compile: unknown; optimize: unknown; Scanner: unknown };

// Dynamic import of an external package: only the shape is checkable, the signatures are the documented Tailwind v4 API.
function isTailwindEngine(candidate: TailwindEngineCandidate): candidate is TailwindEngine {
  return (
    typeof candidate.compile === "function" &&
    typeof candidate.optimize === "function" &&
    typeof candidate.Scanner === "function"
  );
}

// Both packages are the CLI's own dependencies, so they resolve from the CLI package directory
// (same version the CLI would run), not from the app root.
async function loadTailwindEngine(
  cliPath: string,
  bun: { resolveSync: (id: string, from: string) => string },
): Promise<TailwindEngine> {
  const cliDir = dirname(bun.resolveSync("@tailwindcss/cli/package.json", dirname(cliPath)));
  const node: unknown = await import(bun.resolveSync("@tailwindcss/node", cliDir));
  const oxide: unknown = await import(bun.resolveSync("@tailwindcss/oxide", cliDir));
  const engine: TailwindEngineCandidate = {
    compile: isRecord(node) ? node["compile"] : undefined,
    optimize: isRecord(node) ? node["optimize"] : undefined,
    Scanner: isRecord(oxide) ? oxide["Scanner"] : undefined,
  };
  if (!isTailwindEngine(engine)) {
    throw new Error(
      "[kumiko build] @tailwindcss/node or @tailwindcss/oxide has an unexpected API.",
    );
  }
  return engine;
}

// Exact `<base>-<hash>.js` match: a plain prefix check would let
// `client-admin-legacy-<hash>.js` satisfy the `client-admin` entry. The hash is
// alphanumeric, so any further `-` in the remainder means another entry's base.
export function isEntryOutputFor(outName: string, baseName: string): boolean {
  const prefix = `${baseName}-`;
  if (!outName.startsWith(prefix) || !outName.endsWith(".js")) return false;
  return /^[A-Za-z0-9]+$/.test(outName.slice(prefix.length, -".js".length));
}

/** Multi-entry-build: ein Bun.build-Call mit allen entrypoints — shared
 *  chunks werden dedupliziert, hashes deterministisch. Returns map
 *  manifestKey → hashed-filename (basename, ohne /assets/-Prefix). */
async function buildClientBundles(
  entries: readonly ClientEntry[],
  outDir: string,
): Promise<Record<string, string>> {
  if (!hasBun) {
    throw new Error("[kumiko build] requires Bun — run via `bun run …` or `bun kumiko build`.");
  }
  const built = await Bun.build({
    entrypoints: entries.map((e) => e.sourceFile),
    outdir: outDir,
    target: "browser",
    splitting: true,
    minify: true,
    // Keine Source-Maps in Prod: 1.6 MB+ Müll im Container, plus
    // exposed Source-Code reverse-engineerable. Dev hat seine eigenen
    // sourcemaps via create-kumiko-server.ts.
    sourcemap: "none",
    naming: {
      entry: "[name]-[hash].[ext]",
      chunk: "[name]-[hash].[ext]",
      asset: "[name]-[hash].[ext]",
    },
    loader: ASSET_LOADERS,
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
  });
  if (!built.success) {
    const errs = built.logs.map((log) => String(log)).join("\n");
    throw new Error(`[kumiko build] Bun.build failed:\n${errs}`);
  }
  const entryOutputs = built.outputs.filter((o) => o.kind === "entry-point");
  if (entryOutputs.length !== entries.length) {
    throw new Error(
      `[kumiko build] expected ${entries.length} entry-point outputs, got ${entryOutputs.length}`,
    );
  }
  // Bun.build benennt entry-files nach Source-Basename (ohne extension):
  // `src/client-admin.tsx` → `client-admin-<hash>.js`. Wir mappen jedes
  // entry-output zurück auf seinen ClientEntry via Basename-match.
  const result: Record<string, string> = {};
  for (const entry of entries) {
    const baseName = (entry.sourceFile.split("/").pop() ?? "").replace(
      SOURCE_EXTENSION_PATTERN,
      "",
    );
    const match = entryOutputs.find((o) =>
      isEntryOutputFor(o.path.split("/").pop() ?? "", baseName),
    );
    if (!match) {
      throw new Error(
        `[kumiko build] no entry-point output for "${entry.sourceFile}" (looked for "${baseName}-*.js")`,
      );
    }
    result[entry.manifestKey] = match.path.split("/").pop() ?? match.path;
  }
  return result;
}

function basenameOf(p: string): string {
  return p.split("/").pop() ?? p;
}

async function copyPublicFolder(
  src: string,
  dst: string,
  templateBasenames: ReadonlySet<string>,
): Promise<void> {
  // HTML-templates werden separat gerendert — nicht blind kopieren, sonst
  // überschreibt das die injizierte Version. (z.B. index.html, admin.html
  // bei multi-entry).
  await cp(src, dst, {
    recursive: true,
    filter: (source) => {
      const normalized = source.replace(/\\/g, "/");
      const srcNormalized = src.replace(/\\/g, "/");
      const base = normalized.startsWith(`${srcNormalized}/`)
        ? normalized.slice(srcNormalized.length + 1)
        : "";
      return !templateBasenames.has(base);
    },
  });
}

// ---------------------------------------------------------------------------
// HTML render
// ---------------------------------------------------------------------------

async function renderHtml(
  templatePath: string | undefined,
  manifest: BuildManifest,
  entry: ClientEntry,
  buildInfo: BuildInfo | undefined,
): Promise<string> {
  // Edge-Case: kein eigenes HTML-Template + Bun.build oder Tailwind hat
  // Output produziert. DEFAULT_HTML hat keine Placeholder (vanilla
  // template), also würde injectAssetTags eh fehlschlagen. Klarer Fehler
  // mit Vorschlag-Snippet zum Reinkopieren.
  if (!templatePath && Object.keys(manifest).length > 0) {
    throw new Error(buildMissingTemplateError(manifest, entry));
  }
  const template = templatePath ? await readFile(templatePath, "utf8") : DEFAULT_HTML;
  return injectAssetTags(template, manifest, entry, buildInfo);
}

// The message must name the source file and, for a declared multi-entry,
// which package.json "kumiko.clientEntries" entry it came from.
function buildMissingTemplateError(manifest: BuildManifest, entry: ClientEntry): string {
  const cssLine = manifest["styles.css"]
    ? `    <link rel="stylesheet" href="/styles.css" />\n`
    : "";
  const jsLine = manifest[entry.manifestKey]
    ? // html-ok: Error-Hilfetext (Tag-Snippet als Text), wird nie gerendert.
      `    <script type="module" src="/${entry.manifestKey}"></script>\n`
    : "";
  const sourceBasename = basenameOf(entry.sourceFile);
  // Single-mode entries always carry manifestKey "client.js"; any other
  // value came from a declared package.json "kumiko.clientEntries" entry.
  const isMultiEntry = entry.manifestKey !== "client.js";
  const discoveryHint = isMultiEntry
    ? `Entry "${entry.name}" comes from package.json "kumiko.clientEntries" ` +
      `(sourceFile: "src/${sourceBasename}").\n\n`
    : "";
  return (
    `[kumiko build] kein ${entry.htmlPath} gefunden für Entry "src/${sourceBasename}", ` +
    `aber es gibt JS/CSS-Output.\n` +
    discoveryHint +
    `Leg ein public/${basenameOf(entry.htmlPath)} oder ${basenameOf(entry.htmlPath)} im App-Root an, z. B.:\n` +
    `\n` +
    `<!doctype html>\n` +
    `<html>\n` +
    `  <head>\n` +
    `    <meta charset="utf-8" />\n` +
    `    <title>Meine App</title>\n` +
    cssLine +
    `  </head>\n` +
    `  <body>\n` +
    `    <div id="root"></div>\n` +
    jsLine +
    `  </body>\n` +
    `</html>\n` +
    `\n` +
    `Der Build ersetzt /styles.css und /${entry.manifestKey} durch die gehashten URLs.`
  );
}

const BUILD_META_NAME = "kumiko-build";

// @internal — exported nur für Unit-Tests.
//
// Convention: das HTML-Template MUSS Placeholder-Tags für jedes Asset
// dieses Entries enthalten:
//   - `<script type="module" src="/client.js">` für single-mode entry "client"
//   - `<script type="module" src="/client-<name>.js">` für multi-mode entry "<name>"
//   - `<link href="/styles.css">` für styles (gemeinsam über alle entries)
// Der Build ersetzt sie durch die gehashten URLs.
//
// Fehlt ein erwarteter Tag, wirft der Build einen Fehler mit dem exakten
// Snippet zum Reinkopieren — kein silent injection mehr, weil das den
// Diff zwischen Dev- und Prod-HTML unsichtbar macht.
export function injectAssetTags(
  html: string,
  manifest: BuildManifest,
  entry: ClientEntry,
  buildInfo?: BuildInfo,
): string {
  let result = html;

  // Meta tag instead of an inline script: strict CSPs (script-src 'self') block inline scripts.
  // Without </head> (e.g. a fragment) skip silently.
  if (buildInfo && result.includes("</head>")) {
    const tag = `<meta name="${BUILD_META_NAME}" content="${escapeHtmlAttr(buildInfo.id)}" data-built-at="${escapeHtmlAttr(buildInfo.builtAt)}" />`;
    result = result.replace("</head>", `    ${tag}\n  </head>`);
  }

  const cssUrl = manifest["styles.css"];
  if (cssUrl && !result.includes(cssUrl)) {
    const placeholder = /<link\s+rel="stylesheet"\s+href="\/styles\.css"\s*\/?>/.exec(result);
    if (!placeholder) {
      throw new Error(
        buildMissingTagError({
          htmlPath: entry.htmlPath,
          assetKey: "styles.css",
          tagSnippet: `<link rel="stylesheet" href="/styles.css" />`,
          insertHint: "ins <head>",
          hashedAssetHint: "/assets/styles-<hash>.css",
        }),
      );
    }
    // html-ok: cssUrl ist ein selbst-generierter Manifest-Asset-Pfad (Hash-Name).
    result = result.replace(placeholder[0], `<link rel="stylesheet" href="${cssUrl}" />`);
  }

  const jsUrl = manifest[entry.manifestKey];
  if (jsUrl && !result.includes(jsUrl)) {
    // Placeholder-pattern: src="/client.js" oder src="/client-<name>.js"
    const placeholderRx = new RegExp(
      `<script\\b[^>]*src="\\/${entry.manifestKey.replace(/\./g, "\\.")}"[^>]*><\\/script>`,
    );
    const placeholder = placeholderRx.exec(result);
    if (!placeholder) {
      const baseAssetName = entry.manifestKey.replace(/\.js$/, "");
      throw new Error(
        buildMissingTagError({
          htmlPath: entry.htmlPath,
          assetKey: entry.manifestKey,
          tagSnippet: `<script type="module" src="/${entry.manifestKey}"></script>`,
          insertHint: "vor </body>",
          hashedAssetHint: `/assets/${baseAssetName}-<hash>.js`,
        }),
      );
    }
    // html-ok: jsUrl ist ein selbst-generierter Manifest-Asset-Pfad (Hash-Name).
    result = result.replace(placeholder[0], `<script type="module" src="${jsUrl}"></script>`);
  }

  return result;
}

/** Einheitliche Error-Form für fehlende Asset-Tags im HTML-Template
 *  (script-tag fürs JS-Bundle ODER stylesheet-link für Tailwind). */
function buildMissingTagError(args: {
  readonly htmlPath: string;
  readonly assetKey: string;
  readonly tagSnippet: string;
  readonly insertHint: string;
  readonly hashedAssetHint: string;
}): string {
  const tpl = basenameOf(args.htmlPath);
  return (
    `[kumiko build] ${tpl} hat keinen Entry-Tag für /${args.assetKey} — füg ${args.insertHint} ein:\n` +
    `\n` +
    `    ${args.tagSnippet}\n` +
    `\n` +
    `Der Build ersetzt das durch ${args.hashedAssetHint}. Im Dev-Server liefert er die Datei direkt.`
  );
}

// ---------------------------------------------------------------------------
// Hash helpers
// ---------------------------------------------------------------------------

function shortHash(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 8);
}

// Build-Identität aus den content-gehashten Asset-URLs. Sortiert →
// deterministisch (Manifest-Key-Reihenfolge egal). Identischer Source →
// gleiche id, geändertes Asset → andere id.
// @internal — exported nur für Unit-Tests.
export function computeBuildId(manifest: BuildManifest): string {
  return createHash("sha256")
    .update(Object.values(manifest).sort().join("\n"))
    .digest("hex")
    .slice(0, 12);
}

// ---------------------------------------------------------------------------
// CLI output
// ---------------------------------------------------------------------------

/** Formatiert ein BuildResult als CLI-freundliche Mehrzeilen-Zusammenfassung
 *  mit ANSI-Farben. Wird sowohl von `kumiko build` als auch von dem
 *  hoisted `kumiko-build`-Bin verwendet, damit das Output konsistent ist. */
export function formatBuildResult(result: BuildResult, durationMs: number): string {
  const dim = "\x1b[2m";
  const green = "\x1b[32m";
  const reset = "\x1b[0m";
  const lines: string[] = [
    "",
    `  ${green}✓${reset} built ${result.outDir} ${dim}(${durationMs}ms)${reset}`,
  ];
  for (const [logical, hashed] of Object.entries(result.manifest)) {
    lines.push(`    ${dim}${logical.padEnd(14)}${reset} ${hashed}`);
  }
  lines.push("");
  return lines.join("\n");
}
