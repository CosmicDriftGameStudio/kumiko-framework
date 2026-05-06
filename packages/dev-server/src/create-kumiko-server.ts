// Dev server bootstrap. Wires the real Kumiko stack behind a Bun.serve
// shell that also bundles the client, serves it at /client.js, mints
// a JWT for a dev-admin on GET /, and broadcasts SSE reloads when
// source files change. One import + one call is enough for any
// sample's server.ts — the 150-line boilerplate of pre-dev-server
// days lives here now.
//
// Not for production:
//   - auto-mints a JWT for TestUsers.admin on every GET / (anyone
//     hitting the server ends up as admin)
//   - bundles the client in-process (prod uses a prebuilt dist)
//   - no rate-limit, no helmet, no secure-cookie flags
//
// The companion prod entry will land at `@cosmicdrift/kumiko-framework/server`
// with a different options shape (clientDist, auth config, db url).

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, statSync } from "node:fs";
import { readFile, watch } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type AuthRoutesConfig, generateToken } from "@cosmicdrift/kumiko-framework/api";
import { tableExists } from "@cosmicdrift/kumiko-framework/db";
import {
  buildAppSchema,
  type FeatureDefinition,
  type Registry,
} from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  setupTestStack,
  type TestStack,
  type TestStackOptions,
  TestUsers,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { getTableName } from "drizzle-orm";
import { injectSchema } from "./inject-schema";
import { resolveTailwindCli } from "./resolve-tailwind-cli";
import { buildBunServeOptions } from "./run-prod-app";
import { tryHonoFirst } from "./try-hono-first";

// Runtime-detection. The dev-server is meant to run under Bun (Kumiko's
// target runtime), but the test-suite runs under vitest on Node — we
// gate every Bun.* call so the module at least LOADS under Node, and
// tests drive the fetch-handler directly instead of going through
// Bun.serve + real sockets.
const hasBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

// Bun.serve returns a parametrised Server<WebSocketData>; we don't
// touch WebSockets here, so the narrow `unknown` binding is plenty.
// `Bun` isn't declared in Node types, so we fall back to `unknown`
// and only resolve the type when Bun is actually around.
type BunServer = typeof Bun extends undefined ? unknown : ReturnType<typeof Bun.serve>;

// biome-ignore lint/suspicious/noConsole: dev-server status logging
const logInfo = (msg: string): void => console.log(msg);
// biome-ignore lint/suspicious/noConsole: dev-server error logging
const logError = (...args: unknown[]): void => console.error(...args);

/** Multi-Entry-Mode für Apps die mehrere getrennte Bundles ausliefern
 *  (z.B. publicstatus: `admin.<base>` lädt Admin-UI, sonst Public-Page).
 *
 *  Spiegelt die Convention von kumiko-build (`src/client-<name>.tsx`) und
 *  serviert `/client-<name>.js` per HTTP. Multi-Entry ist mutually
 *  exclusive mit `clientEntry`. Wer Multi-Entry nutzt MUSS auch
 *  `hostDispatch` setzen — sonst weiß der Server nicht welches HTML
 *  er rausgeben soll. */
export type DevClientEntry = {
  /** Logical Name. Frei wählbar; Convention: gleicher Suffix wie
   *  `src/client-<name>.tsx` damit der Build identische Asset-URLs
   *  liefert (`/client-<name>.js`). */
  readonly name: string;
  /** Absoluter Pfad zur Browser-Entry-Datei. */
  readonly sourceFile: string;
  /** Optional eigenes HTML-Template für diesen Entry. Wenn nicht gesetzt,
   *  wird `htmlPath` (das default-Template) für alle Entries genutzt. */
  readonly htmlPath?: string;
};

/** Discriminated-Union, identisch zur Form von `runProdApp.hostDispatch`.
 *  Damit kann Dev/Prod-Routing 1:1 gespiegelt werden — ein Apex-404 in
 *  Prod ist ein Apex-404 in Dev (mit `/etc/hosts`-Eintrag für die
 *  betroffene Domain). Schema-Inject ist pro Response steuerbar — ein
 *  Public-Bundle leakt das Admin-Schema nicht, auch nicht in Dev. */
export type DevHostDispatchResult =
  | {
      readonly kind: "html";
      readonly entryName: string;
      /** Default: true. Setze `false` für Public-Routes — analog zu
       *  prod-`injectSchema:false` für Anonymous-Visitors. */
      readonly injectSchema?: boolean;
    }
  | {
      /** Static-HTML: liefert eine Datei wortwörtlich, kein Bundle-Inject,
       *  kein Schema-Inject. Pendant zu prod's `{ kind: "html", file: ...,
       *  injectSchema: false }` für Marketing-/Apex-Pages die kein React
       *  brauchen. Pfad relativ zum Server-CWD. */
      readonly kind: "static-html";
      readonly file: string;
    }
  | { readonly kind: "redirect"; readonly to: string; readonly status?: 301 | 302 }
  | { readonly kind: "not-found" };

/** Picks an entry by inspecting the incoming request. Wird von
 *  Multi-Entry-Apps gesetzt; im Single-Entry-Mode irrelevant. */
export type DevHostDispatch = (req: Request) => DevHostDispatchResult;

export type CreateKumikoServerOptions = {
  /** Features whose entities, handlers, and screens get wired into the
   *  dev stack. Pass every feature the app is supposed to run. */
  readonly features: readonly FeatureDefinition[];
  /** Absolute path to the browser entry module. The dev-server runs
   *  `Bun.build` on it and serves the output at `/client.js`. Omit to
   *  run a headless API-only dev-stack (rare — every sample has one).
   *  Mutually exclusive mit `clientEntries`. */
  readonly clientEntry?: string;
  /** Multi-Entry-Mode: mehrere getrennte Bundles, jeweils unter
   *  `/client-<name>.js`. Mutually exclusive mit `clientEntry`. Setze
   *  `hostDispatch` mit, sonst bleibt unklar welches Template zurück-
   *  geht. */
  readonly clientEntries?: readonly DevClientEntry[];
  /** Multi-Entry-Mode: Routing pro Request. Inspiziert `Host` (oder
   *  was auch immer) und liefert eine Discriminated-Union zurück
   *  (html → entry-bundle, redirect → 30x, not-found → 404).
   *  Symmetric zu `runProdApp.hostDispatch` damit dev/prod-Drift
   *  beim Routing unmöglich ist. */
  readonly hostDispatch?: DevHostDispatch;
  /** @internal — ersetzt `Bun.build` für Tests. Default ruft die echte
   *  Bun-Toolchain. Tests unter Node injizieren einen Stub damit der
   *  Routing-Pfad treibbar bleibt ohne Bun.build aufzurufen.
   *  KEIN Public-API-Surface — präfixiert mit `_` damit Konsumenten
   *  wissen dass das ein Test-Seam ist. */
  readonly _buildBundle?: (sourceFile: string) => Promise<{
    readonly js: string;
    readonly map: string;
  }>;
  /** Absolute path to the CSS entry (typischerweise styles.css mit
   *  @import "tailwindcss"). Der dev-server startet dann den
   *  Tailwind-CLI als watcher und servt das kompilierte CSS unter
   *  /styles.css.
   *
   *  Wenn `undefined` UND `clientEntry` gesetzt: resolve die
   *  `@cosmicdrift/kumiko-renderer-web/styles.css`-Default via Package-Exports.
   *  So muss kein Sample mehr den monorepo-relativen Pfad
   *  ../../packages/renderer-web/src/styles.css hardcoden.
   *
   *  `stylesheet: false` → CSS-Pipeline explizit deaktivieren. */
  readonly stylesheet?: string | false;
  /** Optional HTML template served at `GET /`. The dev-server injects
   *  a `<script src="/client.js">` and a reload-listener snippet into
   *  `</body>` if those aren't already there. Defaults to a minimal
   *  empty-body document — enough to boot the client. */
  readonly htmlPath?: string;
  /** Port to listen on. Default 4173. Overridable via `PORT` env. */
  readonly port?: number;
  /** Extra directories to watch for reload triggers. The entry's
   *  directory is watched automatically. */
  readonly watchDirs?: readonly string[];
  /** When false, no SIGINT/SIGTERM handlers are installed. Tests set
   *  this so repeated `createKumikoServer` calls don't accumulate
   *  listeners on the process. Default true (dev-server behaviour). */
  readonly installSignalHandlers?: boolean;
  /** Auth-Route-Config (login, tenants, switch-tenant, logout). Wenn
   *  gesetzt wird die Auto-JWT-Mint auf GET / abgeschaltet — der
   *  Client ist dann selbst fürs Login zuständig. Zur echten Wirkung
   *  brauchen die dazugehörigen Features (user/tenant/auth-email-
   *  password) via `features` drin sein. */
  readonly auth?: AuthRoutesConfig;
  /** Extra-AppContext-Keys (z.B. configResolver für config-feature).
   *  Wird an setupTestStack weitergereicht. Siehe TestStackOptions
   *  für die erlaubten Shapes (object oder factory-function). */
  readonly extraContext?: TestStackOptions["extraContext"];
  /** Anonymous-Access aktivieren — Requests ohne JWT werden als
   *  Pseudo-User mit Rolle `anonymous` durchgelassen, sofern der
   *  Handler `roles: ["anonymous"]` deklariert. Tenant-Resolution per
   *  Header/Cookie/Default; siehe AnonymousAccessConfig. */
  readonly anonymousAccess?: TestStackOptions["anonymousAccess"];
  /** Wird nach dem Aufsetzen der Entity-Tabellen aufgerufen. Hook für
   *  non-entity-tables (unsafePushTables) und Seeding (admin user, initial
   *  tenant, …). Muss idempotent sein — im persistent-DB-Modus läuft
   *  es bei jedem Boot. */
  readonly onAfterSetup?: (stack: TestStack) => Promise<void>;
  /** Mount-Point für app-eigene HTTP-Routes außerhalb des Dispatcher-
   *  Systems — symmetrisch zum runProdApp.extraRoutes. Wird VOR der
   *  Static/HTML-Auslieferung aufgerufen, sodass eigene GETs (/feed.xml,
   *  /og-image, …) Vorrang vor dem Dev-Asset-Pfad haben. `deps` statt
   *  `ctx` weil dies kein HandlerContext ist — kein user/tenant. */
  readonly extraRoutes?: (
    app: import("hono").Hono,
    deps: { db: TestStack["db"]; redis: TestStack["redis"] },
  ) => void;
};

export type KumikoServerHandle = {
  /** The fetch handler that routes a Request through the dev-server
   *  layer (HTML, /client.js, /_reload, SSE) and falls back to the
   *  underlying Kumiko stack. Tests call this directly to exercise
   *  the routing without going through real sockets. */
  readonly fetch: (req: Request) => Promise<Response>;
  /** Bun.serve instance. `undefined` when running outside Bun (e.g.
   *  in vitest under Node) — the handle still works via `.fetch`. */
  readonly server: BunServer | undefined;
  readonly stack: TestStack;
  /** Stops the server and tears down the stack (DB + redis). */
  readonly stop: () => Promise<void>;
};

const CSRF_COOKIE = "kumiko_csrf";
const AUTH_COOKIE = "kumiko_auth";

// Reload snippet injected into every page-load so the browser
// subscribes to /_reload without the HTML needing to hard-code it.
//
// Zwei reload-Trigger:
//   - explizites `reload`-Event vom Server beim hot-reload (rebuild + send)
//   - implizites: jede SSE-Connection bekommt beim Connect ein `boot`-Event
//     mit der bootId des aktuellen Server-Process. Das Snippet merkt sich
//     die erste bootId; wenn nach einem Reconnect (Server-Restart!) eine
//     ANDERE bootId kommt, refresh — sonst bleibt der Browser ewig auf
//     dem alten Bundle hängen wenn der Watcher classifyChange="restart"
//     gewählt hat oder der User Ctrl-C/yarn dev gemacht hat.
const RELOAD_SNIPPET = `
<script>
  (() => {
    const es = new EventSource("/_reload");
    let firstBootId = null;
    es.addEventListener("boot", (e) => {
      if (firstBootId === null) {
        firstBootId = e.data;
      } else if (firstBootId !== e.data) {
        location.reload();
      }
    });
    es.addEventListener("reload", () => location.reload());
  })();
</script>
`;

// Minimal HTML when the caller didn't hand one in. `#root` is the
// default mount target for `createKumikoApp`, so the one-line client
// can attach without the sample having to ship its own template.
const DEFAULT_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Kumiko</title>
  </head>
  <body>
    <div id="root"></div>
    <script src="/client.js"></script>
  </body>
</html>
`;

type ClientBundle = { readonly js: string; readonly map: string };

async function buildClient(entry: string): Promise<ClientBundle> {
  if (!hasBun) {
    throw new Error(
      "[kumiko-server] clientEntry is only supported under Bun — Bun.build is unavailable in this runtime.",
    );
  }
  const unminified = process.env["KUMIKO_DEV_UNMINIFIED"] === "1";
  const built = await Bun.build({
    entrypoints: [entry],
    target: "browser",
    minify: !unminified,
    sourcemap: "linked",
  });
  if (!built.success) {
    logError("[kumiko-server] client bundle failed:");
    for (const log of built.logs) logError(log);
    throw new Error("client bundle failed");
  }
  const jsOutput = built.outputs.find((o) => o.path.endsWith(".js"));
  const mapOutput = built.outputs.find((o) => o.path.endsWith(".js.map"));
  if (!jsOutput) throw new Error("[kumiko-server] client bundle produced no .js output");
  return {
    js: await jsOutput.text(),
    map: mapOutput ? await mapOutput.text() : "",
  };
}

type ReloadClient = {
  readonly controller: ReadableStreamDefaultController<Uint8Array>;
  readonly encoder: TextEncoder;
  closed: boolean;
};

function injectReload(html: string): string {
  if (html.includes("/_reload")) return html;
  return html.includes("</body>")
    ? html.replace("</body>", `${RELOAD_SNIPPET}</body>`)
    : html + RELOAD_SNIPPET;
}

// Injiziert <link rel="stylesheet" href="/styles.css"> in den <head>,
// wenn es noch nicht da ist. Wird nur aufgerufen wenn die App das
// stylesheet-Option genutzt hat — andernfalls kommt keine CSS-Route.
function injectStylesheet(html: string): string {
  if (html.includes('href="/styles.css"')) return html;
  const link = '<link rel="stylesheet" href="/styles.css" />';
  return html.includes("</head>")
    ? html.replace("</head>", `  ${link}\n</head>`)
    : `${link}${html}`;
}

// injectSchema lebt in `./inject-schema.ts` damit dev-server + prod-
// server denselben Inject-Pfad nutzen.

async function watchDir(
  dir: string,
  onChange: (filename: string) => void,
  signal: AbortSignal,
): Promise<void> {
  // AbortSignal wird vom Server-stop() ausgelöst: ohne den Abort liefe
  // die for-await-Schleife bis zum Process-Exit weiter. Im Test-Setup
  // (afterEach räumt tmpdir mit rmSync auf) sähe der Watcher dann das
  // rmSync, klassifizierte's als "restart" und riefe process.exit(75) —
  // bubbles als unhandled error in vitest hoch.
  const watcher = watch(dir, { recursive: true, signal });
  try {
    for await (const ev of watcher) {
      if (ev.filename) onChange(ev.filename);
    }
  } catch (err) {
    // signal.abort() wirft AbortError aus dem async-iterator; das ist
    // gewollt und kein Fehler. Andere Errors weiterreichen.
    if ((err as { name?: string }).name === "AbortError") return;
    throw err;
  }
}

// Klassifiziert eine geänderte Datei: `hot-reload` für Client-Side
// (Browser-Bundle rebuild + reload), `restart` für Server-Side (Bun-
// Module-Cache zwingt einen Process-Restart durch), `ignore` für
// alles was den Server nicht beeinflusst (Tests, .css, .json…).
//
// Heuristik:
//   - Tests (`__tests__/` oder `*.test.ts(x)`) → ignore
//   - `.ts` / `.tsx` außer Tests:
//       - Client-side-Dirs (`/web/`, `/admin/`, `/public/`, `/client/`)
//         oder die client-entry-Datei selbst → hot-reload
//       - sonst → restart (könnte Schema/Feature-Definition sein)
//   - andere Dateitypen → ignore (kein TS rebuild nötig)
//
// Warum mehrere Dirs für client-side: in Kumiko-Samples gibt's keine
// Convention. publicstatus splittet `/admin/` (Admin-Bundle) und
// `/public/` (Anonymous-Bundle); beammycar nutzt `/web/` für seine
// Feature-Web-Code; ältere Samples haben einfach `/client.tsx` neben
// dem Server. Der Watcher muss alle drei verstehen, sonst löst ein
// Edit der Bridge-Component einen kompletten Server-Restart aus —
// kostet 2-3s, droppt die Test-DB im ephemeral-Modus, reseed läuft
// erneut. Ineffektiv und für der User verwirrend.
//
// Exportiert für Tests; intern wird's von der Watcher-Loop gerufen.
export function classifyChange(filename: string): "restart" | "hot-reload" | "ignore" {
  if (!filename.endsWith(".ts") && !filename.endsWith(".tsx")) return "ignore";
  if (filename.includes("__tests__")) return "ignore";
  if (filename.endsWith(".test.ts") || filename.endsWith(".test.tsx")) return "ignore";
  if (filename.endsWith(".integration.ts") || filename.endsWith(".e2e.ts")) return "ignore";
  // Plattformpfad-agnostisch: prüfen auf POSIX und Windows-Trenner.
  // Wir matchen sowohl `<sep><dir><sep>` als auch trailing-`<sep><dir>`
  // (für Watcher-Filenames die als relativer Pfad ankommen).
  const clientSubdirs = ["web", "admin", "public", "client"];
  for (const dir of clientSubdirs) {
    if (
      filename.includes(`/${dir}/`) ||
      filename.includes(`\\${dir}\\`) ||
      filename.startsWith(`${dir}/`) ||
      filename.startsWith(`${dir}\\`)
    ) {
      return "hot-reload";
    }
  }
  if (filename.endsWith("/client.tsx") || filename.endsWith("/client.ts")) {
    return "hot-reload";
  }
  return "restart";
}

// Expandiert watchDirs-Patterns auf konkrete Verzeichnisse. Ein Eintrag
// ohne `*` wird als gewöhnlicher Pfad resolved; mit `*` wird er per
// glob expanded und alle Treffer die Verzeichnisse sind übernommen.
// Erlaubt z.B. `"../../../packages/*/src"` statt vier hart-kodierte
// Pfade. Glob ist sync — wird einmal beim Boot ausgewertet, nicht
// während der Watcher läuft.
function expandWatchPatterns(patterns: readonly string[]): string[] {
  const out: string[] = [];
  for (const p of patterns) {
    if (!p.includes("*")) {
      out.push(resolve(p));
      continue;
    }
    // expandWatchPatterns wird nur unter Bun aufgerufen (createKumikoServer
    // ist Bun-only); der ?.! -dance ist nötig weil TS Bun nicht im
    // globalThis-default sieht. Wenn Bun fehlt, ist der Aufrufstapel eh
    // schon fail-fast unten in Bun.serve.
    const BunRef = (
      globalThis as {
        Bun?: {
          Glob: new (
            p: string,
          ) => { scanSync: (opts: { onlyFiles: false; cwd: string }) => Iterable<string> };
        };
      }
    ).Bun;
    if (!BunRef) throw new Error("expandWatchPatterns requires Bun.Glob");
    const glob = new BunRef.Glob(p);
    const matches = Array.from(glob.scanSync({ onlyFiles: false, cwd: process.cwd() }));
    for (const m of matches) {
      const abs = resolve(m);
      try {
        if (statSync(abs).isDirectory()) out.push(abs);
      } catch {
        // ignore unreadable matches — typisch defekte Symlinks
      }
    }
  }
  return out;
}

// Resolve den Pfad zur Tailwind-Entry-CSS. Mehrere Fälle:
//   - Explicit string  → den resolved'en absoluten Pfad verwenden
//   - false            → CSS-Pipeline aus (undefined zurück)
//   - undefined + client(s):
//       1. App-eigenes src/styles.css (App-Theme-Override) wenn vorhanden
//       2. Sonst Default `@cosmicdrift/kumiko-renderer-web/styles.css` über Package-Exports
//   - undefined + kein clientEntry/clientEntries: undefined (keine CSS nötig)
//
// Auto-Detection von src/styles.css spiegelt die Logik aus
// build-prod-bundle:resolveStylesheetEntry — damit dev und prod identisch
// resolven. Ohne diesen Check müsste jede App `stylesheet: "./src/styles.css"`
// setzen, sonst greift in dev der renderer-web-Default und Brand-Tokens
// werden ignoriert (DX-Falle).
//
// @internal — exportiert nur für Unit-Tests, nicht aus dem Package-Index
//   re-exportiert. Konsumenten gehen ausschließlich über die `stylesheet`-
//   Option der createKumikoServer-Aufrufstelle.
export function resolveStylesheet(options: CreateKumikoServerOptions): string | undefined {
  if (options.stylesheet === false) return undefined;
  if (typeof options.stylesheet === "string") return resolve(options.stylesheet);
  const hasAnyEntry =
    options.clientEntry !== undefined ||
    (options.clientEntries !== undefined && options.clientEntries.length > 0);
  if (!hasAnyEntry) return undefined;

  // App-eigenes src/styles.css schlägt den renderer-web-Default — gleiche
  // Logik wie kumiko-build, damit lokal/prod identisch bauen.
  const local = resolve(process.cwd(), "src/styles.css");
  if (existsSync(local)) return local;

  // Bun.resolveSync folgt Package-Exports — "./styles.css" in renderer-web's
  // package.json. Das Monorepo auflöst direkt auf den Workspace-File, eine
  // installierte Fremd-App auf den node_modules-File. Kein `fileURLToPath`
  // nötig, Bun gibt schon einen absoluten FS-Pfad zurück.
  if (!hasBun) {
    // Unit-Tests unter vitest/Node landen hier. Ohne Bun können wir die
    // Package-Export-Resolution nicht machen — und im Test-Kontext gibt's
    // keine echte Tailwind-Pipeline. Skip still, keine Fehlermeldung nötig.
    return undefined;
  }
  try {
    return (
      globalThis as { Bun: { resolveSync: (id: string, from: string) => string } }
    ).Bun.resolveSync("@cosmicdrift/kumiko-renderer-web/styles.css", process.cwd());
  } catch (err) {
    logError(
      "[kumiko-server] couldn't auto-resolve @cosmicdrift/kumiko-renderer-web/styles.css — " +
        "pass `stylesheet: <path>` or `stylesheet: false` explicitly.",
      err,
    );
    return undefined;
  }
}

// Startet den Tailwind-CLI als watch-Prozess. Failure-Mode ist
// non-fatal (return undefined): kann der CLI nicht resolved werden
// oder failt der initial-Build (z.B. flakiges Netz, fehlende
// Dependency), bootet der Server ohne CSS statt zu sterben.
async function startTailwindWatcher(
  entryCss: string,
): Promise<{ outPath: string; kill: () => void } | undefined> {
  const bunResolver = hasBun
    ? (globalThis as { Bun: { resolveSync: (id: string, from: string) => string } }).Bun
    : undefined;
  const cliPath = resolveTailwindCli({ bun: bunResolver, cwd: process.cwd() });
  if (cliPath === undefined) {
    logError(
      "[kumiko-server] @tailwindcss/cli nicht auflösbar — booting ohne CSS-Pipeline. " +
        "`bun install` und Restart, um Styles zu aktivieren.",
    );
    return undefined;
  }
  const outDir = mkdtempSync(join(tmpdir(), "kumiko-tw-"));
  const outPath = join(outDir, "styles.css");
  logInfo(`[kumiko-server] tailwind watcher → ${outPath}`);
  const bunPath = process.argv[0] ?? "bun";
  // Initial-Build blockend, damit der erste /styles.css-Request kein
  // 404 bekommt. Dann den watcher im Hintergrund mit unref() — sonst
  // hing er beim Parent-Crash als orphan-process.
  try {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const child = spawn(bunPath, ["run", cliPath, "-i", entryCss, "-o", outPath], {
        stdio: "inherit",
      });
      child.on("exit", (code) => {
        if (code === 0) resolvePromise();
        else rejectPromise(new Error(`tailwind one-shot-build exit ${code}`));
      });
      child.on("error", rejectPromise);
    });
  } catch (err) {
    logError("[kumiko-server] tailwind one-shot-build fehlgeschlagen — booting ohne CSS:", err);
    return undefined;
  }
  const watcher = spawn(bunPath, ["run", cliPath, "-i", entryCss, "-o", outPath, "--watch"], {
    stdio: "inherit",
  });
  watcher.unref();
  return {
    outPath,
    kill: () => {
      try {
        watcher.kill("SIGTERM");
      } catch {
        // schon tot oder nie gestartet — nicht weiter relevant
      }
    },
  };
}

// Push all implicit-projection tables — one per r.entity() — that the
// registry knows about. setupTestStack already handles explicit
// projections, MSPs, and r.rawTable() declarations in its own loop;
// implicit projections are the missing piece for a fresh boot. Idempotent
// via tableExists so a persistent dev DB (KUMIKO_DEV_DB_NAME) reuses
// existing tables on reboot. One batched push at the end (drizzle-kit
// generateMigration runs once over the whole missing set).
async function pushEntityProjectionTables(stack: TestStack, registry: Registry): Promise<void> {
  const seen = new Set<unknown>();
  const missing: Record<string, unknown> = {};

  for (const [projName, proj] of registry.getAllProjections()) {
    if (!proj.isImplicit) continue;
    if (seen.has(proj.table)) continue;
    seen.add(proj.table);
    // @cast-boundary drizzle-bridge — ProjectionTable + PgTable both round-trip
    // through getTableName at runtime; the type system can't unify them.
    const physical = getTableName(proj.table as Parameters<typeof getTableName>[0]);
    if (await tableExists(stack.db, `public.${physical}`)) {
      logInfo(`[kumiko-server] table ${physical} already exists — skipping create`);
      continue;
    }
    missing[projName] = proj.table;
  }

  if (Object.keys(missing).length > 0) {
    await unsafePushTables(stack.db, missing);
  }
}

/** @internal — normalisierte Client-Entry-Form, einheitlich über
 *  Single-Mode (`clientEntry`) und Multi-Mode (`clientEntries`). */
type NormalizedEntry = {
  readonly name: string;
  readonly sourceFile: string;
  readonly htmlPath: string | undefined;
};

/** URL-Pfad unter dem ein Entry ausgeliefert wird. "client" → /client.js
 *  (Single-Mode-Default), sonst "/client-<name>.js". Single-Source-of-Truth
 *  damit Routing + Logging dieselbe Konvention nutzen. */
function assetPathFor(entryName: string): string {
  return entryName === "client" ? "/client.js" : `/client-${entryName}.js`;
}

function normalizeEntries(options: CreateKumikoServerOptions): readonly NormalizedEntry[] {
  if (options.clientEntries !== undefined && options.clientEntry !== undefined) {
    throw new Error(
      "[kumiko-server] clientEntry und clientEntries sind mutually exclusive — wähle eins",
    );
  }
  if (options.clientEntries !== undefined && options.clientEntries.length > 0) {
    if (options.hostDispatch === undefined) {
      throw new Error(
        "[kumiko-server] clientEntries braucht hostDispatch — sonst weiß der Server nicht welches Template er liefern soll",
      );
    }
    return options.clientEntries.map((e) => ({
      name: e.name,
      sourceFile: resolve(e.sourceFile),
      htmlPath: e.htmlPath,
    }));
  }
  if (options.clientEntry !== undefined) {
    return [{ name: "client", sourceFile: resolve(options.clientEntry), htmlPath: undefined }];
  }
  return [];
}

export async function createKumikoServer(
  options: CreateKumikoServerOptions,
): Promise<KumikoServerHandle> {
  const port = options.port ?? Number(process.env["PORT"] ?? 4173);

  // --- client bundles (single-entry oder multi-entry über dieselbe Map) ---
  const entries = normalizeEntries(options);
  const buildBundle = options._buildBundle ?? buildClient;
  const clientBundles = new Map<string, ClientBundle>();
  for (const e of entries) {
    const bundle = await buildBundle(e.sourceFile);
    clientBundles.set(e.name, bundle);
    logInfo(
      `[kumiko-server] client bundle ${e.name}: ${bundle.js.length.toLocaleString()} bytes` +
        (bundle.map ? ` (+ ${bundle.map.length.toLocaleString()} bytes sourcemap)` : ""),
    );
  }

  // --- Tailwind stylesheet (optional) ---
  // Tailwind-CLI läuft im watch-mode, schreibt in ein temp-file, der
  // dev-server liest es bei jedem /styles.css-Request frisch. Nicht
  // Super-Performant, aber keine in-memory-Signal-Gymnastik nötig
  // und der Browser-Reload kommt eh nur nach Bundle-Rebuild.
  //
  // Default-Resolution: wenn kein `stylesheet` übergeben und ein
  // `clientEntry` existiert, resolve die styles.css aus
  // `@cosmicdrift/kumiko-renderer-web` via Package-Exports. Bun.resolveSync liefert
  // einen absoluten Pfad — funktioniert sowohl im Monorepo (Workspace-
  // Link) als auch in einer installierten Fremd-App (node_modules).
  let stylesheetPath: string | undefined;
  let killTailwind: (() => void) | undefined;
  const resolvedStylesheet = resolveStylesheet(options);
  if (resolvedStylesheet !== undefined) {
    const handle = await startTailwindWatcher(resolvedStylesheet);
    if (handle !== undefined) {
      stylesheetPath = handle.outPath;
      killTailwind = handle.kill;
    }
  }

  // --- HTML templates ---
  // Single-Entry: ein Template (htmlPath oder DEFAULT_HTML) für alles.
  // Multi-Entry: pro Entry ein Template (entry.htmlPath ?? options.htmlPath
  // ?? DEFAULT_HTML). Der hostDispatch wählt zur Request-Zeit.
  const defaultTemplate =
    options.htmlPath !== undefined
      ? await readFile(resolve(options.htmlPath), "utf-8")
      : DEFAULT_HTML;
  const htmlTemplates = new Map<string, string>();
  for (const e of entries) {
    htmlTemplates.set(
      e.name,
      e.htmlPath !== undefined ? await readFile(resolve(e.htmlPath), "utf-8") : defaultTemplate,
    );
  }

  // --- Kumiko stack ---
  // KUMIKO_DEV_DB_NAME switches the underlying testDb from ephemeral
  // (fresh kumiko_test_<random>, dropped on cleanup) to persistent
  // (reuses the named DB across restarts). The var is framework-scoped
  // on purpose — every dev-server pattern benefits from the same
  // toggle, not just one sample.
  const devDbName = process.env["KUMIKO_DEV_DB_NAME"];
  const persistentDb = devDbName !== undefined && devDbName !== "";

  logInfo(
    `[kumiko-server] booting Kumiko stack${
      persistentDb ? ` — persistent DB "${devDbName}"` : " — ephemeral test DB"
    }…`,
  );
  const stack = await setupTestStack({
    features: options.features,
    ...(persistentDb && { dbName: devDbName, persistentDb: true }),
    ...(options.auth !== undefined && { authConfig: options.auth }),
    ...(options.extraContext !== undefined && { extraContext: options.extraContext }),
    ...(options.anonymousAccess !== undefined && { anonymousAccess: options.anonymousAccess }),
  });
  await createEventsTable(stack.db);
  await pushEntityProjectionTables(stack, stack.registry);

  // Hook für Caller-spezifische Tables + Seed. Läuft nach den Entity-
  // Tabellen damit das Sample auf `stack.db` / `stack.dispatcher`
  // zugreifen kann, und VOR dem Server-Start damit der erste HTTP-Request
  // bereits gegen einen gefüllten State läuft. Idempotenz ist Caller-
  // Verantwortung (persistent-DB-Modus läuft es bei jedem Boot).
  if (options.onAfterSetup !== undefined) {
    await options.onAfterSetup(stack);
  }

  // App-eigene HTTP-Routes ans Hono-app hängen — symmetrisch zur
  // gleichnamigen Option in runProdApp. Wird vor dem dev-fallback
  // (HTML/JS/CSS-Serving via handleFetch unten) registriert, damit
  // explizite Routen wie /feed.xml den Asset-Pfad schlagen.
  if (options.extraRoutes !== undefined) {
    options.extraRoutes(stack.app, { db: stack.db, redis: stack.redis });
  }

  // setupTestStack konfiguriert den eventDispatcher, startet ihn aber
  // NICHT — Integration-Tests drain'en deterministisch via runOnce().
  // Ein Dev-Server will das laufende Polling, damit SSE-Broadcasts
  // (system-hook sse, Priorität 1001) von selbst an connected Clients
  // fließen. Ohne start() bleiben alle Events in der events-Tabelle
  // liegen und die Tabs sehen nichts.
  if (stack.eventDispatcher) {
    await stack.eventDispatcher.start();
  }

  // Dev user = TestUsers.admin. Demo features are openToAll but the
  // auth-middleware still needs a valid JWT to let the request past.
  // Nicht genutzt wenn `options.auth` gesetzt ist — dann macht der Client
  // selbst den Login.
  const autoMintJwt = options.auth === undefined;
  const devUser = TestUsers.admin;

  // AppSchema einmal beim Boot bauen. Sample-clients ohne explizites
  // schema-Argument lesen das via window.__KUMIKO_SCHEMA__ aus — der
  // dev-server injiziert das in jede HTML-Response. Re-build NICHT
  // bei Hot-Reload weil sich Feature-Defs nur über einen restart
  // ändern.
  const appSchemaJson = JSON.stringify(buildAppSchema(stack.registry));

  // --- SSE reload ---
  // bootId identifiziert diese spezifische Server-Process-Instanz. Wird
  // beim Connect an jeden Browser geschickt; Browser merkt sich den
  // ersten Wert und refresht wenn beim Reconnect ein anderer kommt
  // (= Server wurde restartet, alter JS-Bundle ist stale). Siehe
  // RELOAD_SNIPPET oben.
  const bootId = String(Date.now());
  const reloadClients = new Set<ReloadClient>();
  const broadcastReload = (): void => {
    const payload = "event: reload\ndata: now\n\n";
    for (const client of reloadClients) {
      if (client.closed) continue;
      try {
        client.controller.enqueue(client.encoder.encode(payload));
      } catch {
        client.closed = true;
      }
    }
  };

  // Build a fresh HTML response. Im Auto-Mint-Modus (keine auth-Config)
  // packen wir direkt ein gültiges JWT + CSRF-Cookie rein — Deep-Links
  // funktionieren sofort ohne Login. Im Auth-Modus serven wir nur die
  // nackte HTML; der Client geht dann durch /auth/login und bekommt die
  // Cookies von dort.
  //
  // entryName + injectSchemaForEntry werden vom Caller (handleFetch)
  // bestimmt nachdem er hostDispatch evaluiert hat. Ohne hostDispatch
  // ist es immer "client" mit Schema-Inject true (Single-Entry-Default
  // damit der Client TypeScript-Schemas findet).
  const htmlResponse = async (entryName: string, doInjectSchema: boolean): Promise<Response> => {
    const template = htmlTemplates.get(entryName) ?? defaultTemplate;
    const headers = new Headers();
    headers.set("Content-Type", "text/html; charset=utf-8");
    if (autoMintJwt) {
      const jwt = await stack.jwt.sign(devUser);
      const csrf = generateToken();
      headers.append("Set-Cookie", `${AUTH_COOKIE}=${jwt}; Path=/; HttpOnly; SameSite=Lax`);
      headers.append("Set-Cookie", `${CSRF_COOKIE}=${csrf}; Path=/; SameSite=Lax`);
    }
    let html = injectReload(template);
    if (stylesheetPath !== undefined) html = injectStylesheet(html);
    if (doInjectSchema) html = injectSchema(html, appSchemaJson);
    return new Response(html, { headers });
  };

  // --- Fetch handler (runtime-neutral) ---
  // Bundle-Pfad-Lookup: für jede Entry serven wir
  //   GET /client[-name].js      → JS-Bundle
  //   GET /client[-name].js.map  → Sourcemap
  // assetPathFor() ist die Single-Source-of-Truth für die URL-Form.
  const bundleByAssetPath = new Map<string, string>();
  for (const e of entries) bundleByAssetPath.set(assetPathFor(e.name), e.name);

  const handleFetch = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);

    // Specific routes first — assets, reload-SSE, API.
    if (req.method === "GET") {
      const bundleName = bundleByAssetPath.get(url.pathname);
      if (bundleName !== undefined) {
        const bundle = clientBundles.get(bundleName);
        if (bundle === undefined) return new Response("no bundle", { status: 404 });
        return new Response(bundle.js, {
          headers: { "Content-Type": "application/javascript; charset=utf-8" },
        });
      }
      // .js.map-Variante: gleicher Lookup mit /.map abgeschnitten.
      if (url.pathname.endsWith(".js.map")) {
        const jsPath = url.pathname.slice(0, -".map".length);
        const mapName = bundleByAssetPath.get(jsPath);
        if (mapName !== undefined) {
          const bundle = clientBundles.get(mapName);
          if (bundle === undefined || !bundle.map) {
            return new Response("no map", { status: 404 });
          }
          return new Response(bundle.map, {
            headers: { "Content-Type": "application/json; charset=utf-8" },
          });
        }
      }
    }

    if (url.pathname === "/styles.css" && req.method === "GET") {
      if (stylesheetPath === undefined) return new Response("no stylesheet", { status: 404 });
      const css = await readFile(stylesheetPath, "utf-8");
      return new Response(css, {
        headers: { "Content-Type": "text/css; charset=utf-8" },
      });
    }

    if (url.pathname === "/_reload" && req.method === "GET") {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const entry: ReloadClient = { controller, encoder, closed: false };
          reloadClients.add(entry);
          controller.enqueue(encoder.encode(": connected\n\n"));
          // boot-Event: Browser-Snippet vergleicht das mit der ersten
          // bootId. Verschiedener Wert nach Reconnect = Server wurde
          // restartet → location.reload().
          controller.enqueue(encoder.encode(`event: boot\ndata: ${bootId}\n\n`));
        },
        cancel() {
          for (const c of reloadClients) {
            if (c.closed) reloadClients.delete(c);
          }
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    // SPA catch-all: any GET to a non-API, non-asset path returns the
    // HTML shell. The client-side router then reads location.pathname
    // and mounts the right screen. The "no dot" filter skips
    // /favicon.ico etc. (let the stack's 404 handler respond).
    //
    // Backend routes that live outside /api (currently just /sse) have
    // to be excluded explicitly, otherwise the catch-all would shadow
    // the real Hono route with HTML and EventSource would never
    // connect.
    //
    // Plus: r.httpRoute-deklarierte Feature-Routes (z.B. /legal/*) liegen
    // ebenfalls außerhalb /api und matchen sonst diesen catch-all. Wir
    // probieren daher ZUERST stack.app.fetch — wenn Hono eine matchende
    // Route hat, gewinnt sie. 404 vom Hono-stack → SPA-fallback wie
    // bisher. Das spiegelt runProdApp's doc-intent ("Hono matched VOR
    // staticDir-fallback") und macht r.httpRoute mit non-/api paths im
    // dev-server symmetrisch zu prod.
    if (
      req.method === "GET" &&
      !url.pathname.startsWith("/api/") &&
      !url.pathname.startsWith("/sse") &&
      !url.pathname.includes(".")
    ) {
      const honoTry = await tryHonoFirst(stack.app, req);
      if (honoTry.matched) {
        return honoTry.response;
      }
      // Discriminated-Dispatch — symmetric zu prod. Ohne hostDispatch
      // landet das im Single-Entry-Default ("client" + Schema-Inject).
      if (options.hostDispatch !== undefined) {
        const dispatch = options.hostDispatch(req);
        if (dispatch.kind === "redirect") {
          return new Response(null, {
            status: dispatch.status ?? 302,
            headers: { Location: dispatch.to },
          });
        }
        if (dispatch.kind === "not-found") {
          return new Response("Not Found", { status: 404 });
        }
        if (dispatch.kind === "static-html") {
          // Raw-File-Serve, kein Bundle-Inject, kein Schema-Inject.
          // Pendant zu prod's `{ kind: "html", file: ..., injectSchema: false }`.
          const file = await readFile(dispatch.file, "utf-8");
          return new Response(file, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }
        return htmlResponse(dispatch.entryName, dispatch.injectSchema ?? true);
      }
      return htmlResponse("client", true);
    }

    return stack.app.fetch(req);
  };

  // --- HTTP server (Bun only) ---
  // Under Node/vitest we skip Bun.serve entirely — the handle's
  // .fetch() is the test surface. Real dev runs under Bun, where
  // Bun.serve wires the listener.
  // Bun.serve-Options kommen aus buildBunServeOptions (run-prod-app.ts)
  // damit Dev und Prod genau dieselben SSE-relevanten Defaults nutzen
  // (idleTimeout: 0). Spec-Test in run-prod-app-spec.test.ts pinst das.
  const server = hasBun
    ? (globalThis as { Bun: { serve: (opts: unknown) => BunServer } }).Bun.serve(
        buildBunServeOptions(port, handleFetch),
      )
    : undefined;

  // --- file watcher → rebundle + reload, oder process-restart bei Schema-Änderungen ---
  // Heuristik: alles in `web/` oder `__tests__/` ist client-side oder
  // test-only — Hot-Reload reicht (rebuild + broadcast reload). Alles
  // andere ist server-side; Bun cached die Module-Imports, also würde ein
  // Schema-Change in feature.ts nicht durchschlagen ohne process-restart.
  // Wir exiten dann mit Code 75 (EX_TEMPFAIL) — `kumiko-dev` Wrapper
  // detected das und respawnt.
  //
  // watcherAbort wird beim stop() ausgelöst → fs.watch beendet die
  // async-iteration → kein Watcher überlebt einen Test-Teardown und
  // klassifiziert ein rmSync(tmpdir) als "restart needed".
  const watcherAbort = new AbortController();
  if (entries.length > 0) {
    // Watch-Dirs: alle entry-Verzeichnisse (deduped) plus die explizit
    // angegebenen watchDirs. In Multi-Entry-Setups liegen die Entries
    // oft im selben src/-Verzeichnis (`src/client-admin.tsx` +
    // `src/client-public.tsx`) — der Set kollabiert das auf einen
    // Watcher pro Verzeichnis.
    const entryDirs = new Set<string>();
    for (const e of entries) entryDirs.add(resolve(e.sourceFile, ".."));
    const dirs = [...entryDirs, ...expandWatchPatterns(options.watchDirs ?? [])];
    for (const dir of dirs) {
      void watchDir(
        dir,
        async (filename) => {
          const action = classifyChange(filename);
          if (action === "ignore") return;
          if (action === "restart") {
            logInfo(
              `[kumiko-server] schema change in ${filename} — restarting (Bun caches imports, hot-reload reicht hier nicht)`,
            );
            await stop();
            process.exit(75);
          }
          try {
            // Alle Entries rebuilden — auch wenn nur eine Datei sich
            // ändert, wir wissen nicht welche Entries sie importieren.
            // Bei zwei Entries mit shared Code triggert ein Edit der
            // gemeinsamen Datei beide Bundles neu, das ist gewollt.
            for (const e of entries) {
              const rebuilt = await buildBundle(e.sourceFile);
              clientBundles.set(e.name, rebuilt);
            }
            logInfo(`[kumiko-server] rebuilt on ${filename}, broadcasting reload`);
            broadcastReload();
          } catch {
            // buildClient already logged the failure; keep serving the
            // last good bundle until the next successful rebuild.
          }
        },
        watcherAbort.signal,
      );
    }
  }

  const stop = async (): Promise<void> => {
    // Watcher zuerst stoppen damit kein onChange während des Teardowns
    // mehr feuert (sonst können tmpdir-rmSync ein process.exit(75)
    // auslösen).
    watcherAbort.abort();
    if (killTailwind) killTailwind();
    if (server !== undefined) {
      (server as { stop: (closeActive?: boolean) => void }).stop(true);
    }
    if (stack.eventDispatcher) {
      await stack.eventDispatcher.stop();
    }
    await stack.cleanup();
  };

  // --- graceful shutdown ---
  // Signal handlers fire on Ctrl-C / kill. Without them, repeated dev
  // restarts leak Postgres pools, lassen Tailwind-Watcher als orphan
  // hängen und (in persistent mode) hinterlassen temp Clients.
  // uncaughtException + unhandledRejection: Crashes hatten den Tailwind-
  // Watcher nicht gekillt, der lief munter weiter im Hintergrund. Jetzt
  // räumen wir auch im Fehlerfall auf bevor wir mit non-zero exit'n.
  const installHandlers = options.installSignalHandlers ?? true;
  if (installHandlers) {
    for (const sig of ["SIGINT", "SIGTERM"] as const) {
      process.on(sig, async () => {
        logInfo(`[kumiko-server] ${sig} — cleaning up…`);
        await stop();
        process.exit(0);
      });
    }
    process.on("uncaughtException", async (err) => {
      logError("[kumiko-server] uncaughtException — cleaning up…", err);
      try {
        await stop();
      } finally {
        process.exit(1);
      }
    });
    process.on("unhandledRejection", async (err) => {
      logError("[kumiko-server] unhandledRejection — cleaning up…", err);
      try {
        await stop();
      } finally {
        process.exit(1);
      }
    });
  }

  if (server !== undefined) {
    logInfo(
      `[kumiko-server] listening on http://localhost:${port}` +
        (entries.length > 0
          ? ` (hot reload on ${entries.length === 1 ? "client entry" : `${entries.length} entries`})`
          : ""),
    );
  }

  return { fetch: handleFetch, server, stack, stop };
}
