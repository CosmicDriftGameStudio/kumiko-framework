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
//   public/index.html | index.html   →  Template, Asset-Tags injiziert
//   (sonst)                          →  Default-HTML mit #root + script-tag
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
  const assetsDir = join(outDir, "assets");

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
    manifest["styles.css"] = `/assets/${filename}`;
  }

  // 4. Bun.build mit splitting + hash + asset-loader
  if (clientEntry) {
    const entryFilename = await buildClientBundle(clientEntry, assetsDir);
    manifest["client.js"] = `/assets/${entryFilename}`;
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

  const hasBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
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
  const tmpDir = await mkdtemp(join(tmpdir(), "kumiko-build-tw-"));
  const outPath = join(tmpDir, "styles.css");
  const proc = Bun.spawn(["bunx", "@tailwindcss/cli", "-i", entry, "-o", outPath], {
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
  const hasBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
  if (!hasBun) {
    throw new Error("[kumiko build] requires Bun — run via `bun run …` or `yarn kumiko build`.");
  }
  const built = await Bun.build({
    entrypoints: [entry],
    outdir: outDir,
    target: "browser",
    splitting: true,
    minify: true,
    sourcemap: "linked",
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
  const template = templatePath ? await readFile(templatePath, "utf8") : DEFAULT_HTML;
  return injectAssetTags(template, manifest);
}

// @internal — exported nur für Unit-Tests.
export function injectAssetTags(html: string, manifest: BuildManifest): string {
  let result = html;

  const cssUrl = manifest["styles.css"];
  if (cssUrl) {
    const link = `<link rel="stylesheet" href="${cssUrl}" />`;
    if (!result.includes(cssUrl)) {
      // Existing <link href="/styles.css"> ersetzen, sonst in </head>
      // injizieren, sonst voranstellen.
      const existingLink = /<link\s+rel="stylesheet"\s+href="\/styles\.css"\s*\/?>/.exec(result);
      if (existingLink) {
        result = result.replace(existingLink[0], link);
      } else if (result.includes("</head>")) {
        result = result.replace("</head>", `  ${link}\n  </head>`);
      } else {
        result = link + result;
      }
    }
  }

  const jsUrl = manifest["client.js"];
  if (jsUrl) {
    const tag = `<script type="module" src="${jsUrl}"></script>`;
    if (!result.includes(jsUrl)) {
      // Existing /client.js Reference ersetzen (Dev-Pattern aus
      // public/index.html), sonst in </body>, sonst anhängen.
      const existingScript = /<script\b[^>]*src="\/client\.js"[^>]*><\/script>/.exec(result);
      if (existingScript) {
        result = result.replace(existingScript[0], tag);
      } else if (result.includes("</body>")) {
        result = result.replace("</body>", `  ${tag}\n  </body>`);
      } else {
        result = result + tag;
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Hash helpers
// ---------------------------------------------------------------------------

function shortHash(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 8);
}
