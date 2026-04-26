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
import { existsSync } from "node:fs";
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
  const clientEntry = discoverClientEntry(cwd);
  const stylesheet = resolveStylesheetEntry(cwd, clientEntry, options.stylesheet);
  const publicDir = resolve(cwd, "public");
  const hasPublicDir = existsSync(publicDir);
  const htmlTemplatePath = discoverHtmlTemplate(cwd);

  if (!clientEntry && !hasPublicDir && !htmlTemplatePath) {
    throw new Error(
      `[kumiko build] nothing to build in ${cwd} — expected at least one of: ` +
        `src/client.tsx, public/, index.html`,
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

  // 4. Bun.build mit splitting + hash + asset-loader
  if (clientEntry) {
    const entryFilename = await buildClientBundle(clientEntry, assetsDir);
    manifest["client.js"] = `/${ASSETS_DIR}/${entryFilename}`;
  }

  // 5. Public-Folder rsync (ohne index.html — das wird separat gerendert)
  if (hasPublicDir) {
    await copyPublicFolder(publicDir, outDir);
  }

  // 6. HTML rendern. Template-Reihenfolge:
  //    1. index.html im cwd (App-Author-Override)
  //    2. public/index.html (häufigster Fall)
  //    3. Default-HTML (für Apps ohne eigenes Template)
  const html = await renderHtml(htmlTemplatePath, manifest);
  await writeFile(join(outDir, "index.html"), html);

  // 7. Manifest.
  await writeFile(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  return { outDir, manifest };
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

// @internal — exported nur für Unit-Tests. Konsumenten gehen über
// buildProdBundle.
export function discoverClientEntry(cwd: string): string | undefined {
  for (const candidate of ["src/client.tsx", "src/client.ts"]) {
    const path = resolve(cwd, candidate);
    if (existsSync(path)) return path;
  }
  return undefined;
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

async function buildClientBundle(entry: string, outDir: string): Promise<string> {
  if (!hasBun) {
    throw new Error("[kumiko build] requires Bun — run via `bun run …` or `yarn kumiko build`.");
  }
  const built = await Bun.build({
    entrypoints: [entry],
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
  const entryOut = built.outputs.find((o) => o.kind === "entry-point");
  if (!entryOut) {
    throw new Error("[kumiko build] Bun.build produced no entry-point output");
  }
  return entryOut.path.split("/").pop() ?? entryOut.path;
}

async function copyPublicFolder(src: string, dst: string): Promise<void> {
  // index.html wird separat gerendert — nicht blind kopieren, sonst
  // überschreibt das die injizierte Version.
  await cp(src, dst, {
    recursive: true,
    filter: (source) => {
      const normalized = source.replace(/\\/g, "/");
      const srcNormalized = src.replace(/\\/g, "/");
      return normalized !== `${srcNormalized}/index.html`;
    },
  });
}

// ---------------------------------------------------------------------------
// HTML render
// ---------------------------------------------------------------------------

async function renderHtml(
  templatePath: string | undefined,
  manifest: BuildManifest,
): Promise<string> {
  // Edge-Case: kein eigenes HTML-Template + Bun.build oder Tailwind hat
  // Output produziert. DEFAULT_HTML hat keine Placeholder (vanilla
  // template), also würde injectAssetTags eh fehlschlagen. Klarer Fehler
  // mit Vorschlag-Snippet zum Reinkopieren.
  if (!templatePath && Object.keys(manifest).length > 0) {
    throw new Error(buildMissingTemplateError(manifest));
  }
  const template = templatePath ? await readFile(templatePath, "utf8") : DEFAULT_HTML;
  return injectAssetTags(template, manifest);
}

function buildMissingTemplateError(manifest: BuildManifest): string {
  const cssLine = manifest["styles.css"]
    ? `    <link rel="stylesheet" href="/styles.css" />\n`
    : "";
  const jsLine = manifest["client.js"]
    ? `    <script type="module" src="/client.js"></script>\n`
    : "";
  return (
    `[kumiko build] kein index.html gefunden, aber es gibt JS/CSS-Output.\n` +
    `Leg ein public/index.html oder index.html im App-Root an, z. B.:\n` +
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
    `Der Build ersetzt /styles.css und /client.js durch die gehashten URLs.`
  );
}

// @internal — exported nur für Unit-Tests.
//
// Convention: das HTML-Template MUSS Placeholder-Tags für jedes Asset
// im Manifest enthalten — `<script src="/client.js">` für client.js,
// `<link href="/styles.css">` für styles.css. Der Build ersetzt sie
// durch die gehashten URLs.
//
// Fehlt ein erwarteter Tag, wirft der Build einen Fehler mit dem exakten
// Snippet zum Reinkopieren — kein silent injection mehr, weil das den
// Diff zwischen Dev- und Prod-HTML unsichtbar macht.
export function injectAssetTags(html: string, manifest: BuildManifest): string {
  let result = html;

  const cssUrl = manifest["styles.css"];
  if (cssUrl && !result.includes(cssUrl)) {
    const placeholder = /<link\s+rel="stylesheet"\s+href="\/styles\.css"\s*\/?>/.exec(result);
    if (!placeholder) {
      throw new Error(buildMissingTagError("styles.css"));
    }
    result = result.replace(placeholder[0], `<link rel="stylesheet" href="${cssUrl}" />`);
  }

  const jsUrl = manifest["client.js"];
  if (jsUrl && !result.includes(jsUrl)) {
    const placeholder = /<script\b[^>]*src="\/client\.js"[^>]*><\/script>/.exec(result);
    if (!placeholder) {
      throw new Error(buildMissingTagError("client.js"));
    }
    result = result.replace(placeholder[0], `<script type="module" src="${jsUrl}"></script>`);
  }

  return result;
}

function buildMissingTagError(asset: "client.js" | "styles.css"): string {
  if (asset === "client.js") {
    return (
      `[kumiko build] index.html hat keinen Entry-Tag für /client.js — füg vor </body> ein:\n` +
      `\n` +
      `    <script type="module" src="/client.js"></script>\n` +
      `\n` +
      `Der Build ersetzt das durch /assets/client-<hash>.js. Im Dev-Server liefert er die Datei direkt.`
    );
  }
  return (
    `[kumiko build] index.html hat keinen Entry-Tag für /styles.css — füg ins <head> ein:\n` +
    `\n` +
    `    <link rel="stylesheet" href="/styles.css" />\n` +
    `\n` +
    `Der Build ersetzt das durch /assets/styles-<hash>.css. Im Dev-Server liefert er die Datei direkt.`
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
