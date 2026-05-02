// buildProdBundle — Production-Build für Kumiko-Apps. Ein generischer
// Build-Step ohne App-spezifisches Wissen: Convention-Discovery liest
// die App-Struktur, Bun.build + Tailwind + Public-Folder-Copy
// produzieren ein deploybares dist/.
//
// Convention (alles optional, fehlt was → übersprungen):
//
//   src/client.tsx | src/client.ts   →  Bun.build (splitting + hash + asset-loader)
//   src/styles.css                   →  Tailwind one-shot
//                                       (oder fallback auf @kumiko/renderer-web/styles.css
//                                        wenn nur clientEntry da ist und kein eigenes CSS)
//   public/                          →  rsync 1:1 (kein Hash — User-bewusste URLs)
//   public/index.html | index.html   →  Template, Placeholder-Tags ersetzt:
//                                         <script src="/client.js"> → /assets/client-<hash>.js
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
import { existsSync, readdirSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
   *  @kumiko/renderer-web/styles.css wenn clientEntry da ist.
   *  `false` deaktiviert die CSS-Pipeline explizit. */
  readonly stylesheet?: string | false;
};

export type BuildManifest = Readonly<Record<string, string>>;

export type BuildResult = {
  readonly outDir: string;
  /** Logical → hashed-URL mapping. Beispiel:
   *    { "client.js": "/assets/client-a3f2.js",
   *      "styles.css": "/assets/styles-9b4c.css" } */
  readonly manifest: BuildManifest;
};

// Default-HTML wird nur genutzt wenn der App-Author KEIN index.html liefert.
// Hat keine Asset-Placeholder, weil der Default-Pfad für vanilla apps
// (nur public/) gedacht ist — wer JS/CSS will, schreibt ein eigenes
// index.html mit den richtigen Placeholder-Tags.
const DEFAULT_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
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
  const clientEntries = discoverClientEntries(cwd);
  const firstClientSource = clientEntries[0]?.sourceFile;
  const stylesheet = resolveStylesheetEntry(cwd, firstClientSource, options.stylesheet);
  const publicDir = resolve(cwd, "public");
  const hasPublicDir = existsSync(publicDir);

  if (clientEntries.length === 0 && !hasPublicDir) {
    throw new Error(
      `[kumiko build] nothing to build in ${cwd} — expected at least one of: ` +
        `src/client.tsx, src/client-*.tsx, public/`,
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
    const css = await runTailwindOnce(stylesheet);
    const hash = shortHash(css);
    const filename = `styles-${hash}.css`;
    await writeFile(join(assetsDir, filename), css);
    manifest["styles.css"] = `/${ASSETS_DIR}/${filename}`;
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
      const html = await renderHtml(templateExists ? templatePath : undefined, manifest, entry);
      const outFile = basenameOf(entry.htmlPath);
      await writeFile(join(outDir, outFile), html);
    }
  }

  // 7. Manifest.
  await writeFile(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  return { outDir, manifest };
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

// Single client-entry shape — one bundle, one html-template.
export type ClientEntry = {
  /** Logical name. "client" für single-mode; sonst der Suffix von
   *  src/client-<suffix>.tsx (z.B. "public", "admin"). */
  readonly name: string;
  /** TypeScript-Source. */
  readonly sourceFile: string;
  /** Manifest-key & logical-asset-path. "client.js" für single, sonst
   *  "client-<name>.js". */
  readonly manifestKey: string;
  /** HTML-template-Pfad relativ zum cwd. "index.html" für single oder
   *  "public"-entry; sonst "<name>.html". Naming bewusst symmetrisch
   *  zu `runDevApp.clientEntries[].htmlPath` damit Build und Dev-Server
   *  dieselbe Konvention verwenden. */
  readonly htmlPath: string;
};

// @internal — exported nur für Unit-Tests. Konsumenten gehen über
// buildProdBundle.
//
// Discovery-Pattern:
//   - Falls `src/client-<suffix>.tsx` files existieren → multi-entry-mode,
//     ein Bundle pro Datei. "public" mapped auf index.html (default),
//     andere Suffixe auf "<suffix>.html".
//   - Sonst falls `src/client.tsx` oder `src/client.ts` existiert →
//     single-entry-mode mit name "client" + index.html.
//   - Sonst leeres Array (keine Client-Bundles).
export function discoverClientEntries(cwd: string): readonly ClientEntry[] {
  const multi = discoverMultiClientEntries(cwd);
  if (multi.length > 0) return multi;

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
  return [];
}

function discoverMultiClientEntries(cwd: string): readonly ClientEntry[] {
  const srcDir = resolve(cwd, "src");
  if (!existsSync(srcDir)) return [];
  let files: readonly string[];
  try {
    files = readdirSync(srcDir);
  } catch {
    return [];
  }
  const out: ClientEntry[] = [];
  for (const file of files) {
    const match = /^client-([a-z][a-z0-9-]*)\.tsx?$/.exec(file);
    const suffix = match?.[1];
    if (!suffix) continue;
    const sourceFile = resolve(srcDir, file);
    out.push({
      name: suffix,
      sourceFile,
      manifestKey: `client-${suffix}.js`,
      // "public"-entry serviert die default-page (index.html), sonst pro
      // Suffix ein eigenes Template.
      htmlPath:
        suffix === "public"
          ? (discoverHtmlTemplateFor(cwd, "index") ?? "index.html")
          : (discoverHtmlTemplateFor(cwd, suffix) ?? `${suffix}.html`),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function discoverHtmlTemplateFor(cwd: string, basename: string): string | undefined {
  for (const candidate of [`${basename}.html`, `public/${basename}.html`]) {
    const path = resolve(cwd, candidate);
    if (existsSync(path)) return path;
  }
  return undefined;
}

/** @deprecated single-entry-Variante. Nutze discoverClientEntries. */
export function discoverClientEntry(cwd: string): string | undefined {
  const entries = discoverClientEntries(cwd);
  if (entries.length !== 1) return undefined;
  const only = entries[0];
  return only?.name === "client" ? only.sourceFile : undefined;
}

function resolveStylesheetEntry(
  cwd: string,
  clientEntry: string | undefined,
  override: BuildProdBundleOptions["stylesheet"],
): string | undefined {
  if (override === false) return undefined;
  if (typeof override === "string") return resolve(cwd, override);

  // App-eigenes styles.css schlägt den Default.
  const local = resolve(cwd, "src/styles.css");
  if (existsSync(local)) return local;

  // Sonst: nur wenn ein client da ist, fallback auf renderer-web/styles.css.
  // Sample-Apps und Showcases nutzen das alle — gleiche Logik wie der dev-
  // server, damit lokal/prod identisch bauen.
  if (!clientEntry) return undefined;

  if (!hasBun) return undefined;
  try {
    return (
      globalThis as { Bun: { resolveSync: (id: string, from: string) => string } }
    ).Bun.resolveSync("@kumiko/renderer-web/styles.css", cwd);
  } catch {
    return undefined;
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

async function runTailwindOnce(entry: string): Promise<string> {
  if (!hasBun) {
    throw new Error(
      "[kumiko build] Tailwind one-shot requires Bun (Bun.spawn) — run via `bun run …` or `yarn kumiko build`.",
    );
  }
  const tmpDir = await mkdtemp(join(tmpdir(), "kumiko-build-tw-"));
  const outPath = join(tmpDir, "styles.css");
  // --minify: Tailwind-CLI default ist NICHT minified. Symmetric zum
  // Bun.build minify-Flag — sonst ist das CSS in dist/ ~30 % größer als
  // nötig (Whitespace, Kommentare, Newlines).
  const proc = Bun.spawn(["bunx", "@tailwindcss/cli", "-i", entry, "-o", outPath, "--minify"], {
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`[kumiko build] tailwind exit ${code}`);
  }
  const css = await readFile(outPath, "utf8");
  await rm(tmpDir, { recursive: true, force: true });
  return css;
}

/** Multi-entry-build: ein Bun.build-Call mit allen entrypoints — shared
 *  chunks werden dedupliziert, hashes deterministisch. Returns map
 *  manifestKey → hashed-filename (basename, ohne /assets/-Prefix). */
async function buildClientBundles(
  entries: readonly ClientEntry[],
  outDir: string,
): Promise<Record<string, string>> {
  if (!hasBun) {
    throw new Error("[kumiko build] requires Bun — run via `bun run …` or `yarn kumiko build`.");
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
    const baseName = (entry.sourceFile.split("/").pop() ?? "").replace(/\.tsx?$/, "");
    const match = entryOutputs.find((o) => {
      const outName = o.path.split("/").pop() ?? "";
      return outName.startsWith(`${baseName}-`);
    });
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
): Promise<string> {
  // Edge-Case: kein eigenes HTML-Template + Bun.build oder Tailwind hat
  // Output produziert. DEFAULT_HTML hat keine Placeholder (vanilla
  // template), also würde injectAssetTags eh fehlschlagen. Klarer Fehler
  // mit Vorschlag-Snippet zum Reinkopieren.
  if (!templatePath && Object.keys(manifest).length > 0) {
    throw new Error(buildMissingTemplateError(manifest, entry));
  }
  const template = templatePath ? await readFile(templatePath, "utf8") : DEFAULT_HTML;
  return injectAssetTags(template, manifest, entry);
}

function buildMissingTemplateError(manifest: BuildManifest, entry: ClientEntry): string {
  const cssLine = manifest["styles.css"]
    ? `    <link rel="stylesheet" href="/styles.css" />\n`
    : "";
  const jsLine = manifest[entry.manifestKey]
    ? `    <script type="module" src="/${entry.manifestKey}"></script>\n`
    : "";
  return (
    `[kumiko build] kein ${entry.htmlPath} gefunden, aber es gibt JS/CSS-Output.\n` +
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

// @internal — exported nur für Unit-Tests.
//
// Convention: das HTML-Template MUSS Placeholder-Tags für jedes Asset
// dieses Entries enthalten:
//   - `<script src="/client.js">` für single-mode entry "client"
//   - `<script src="/client-<name>.js">` für multi-mode entry "<name>"
//   - `<link href="/styles.css">` für styles (gemeinsam über alle entries)
// Der Build ersetzt sie durch die gehashten URLs.
//
// Fehlt ein erwarteter Tag, wirft der Build einen Fehler mit dem exakten
// Snippet zum Reinkopieren — kein silent injection mehr, weil das den
// Diff zwischen Dev- und Prod-HTML unsichtbar macht.
export function injectAssetTags(html: string, manifest: BuildManifest, entry: ClientEntry): string {
  let result = html;

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
