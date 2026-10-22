/// <reference types="bun-types" preserve="true" />
import { statSync } from "node:fs";
import { watch } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type ClientBundle,
  type ClientBundleBuilder,
  type NormalizedEntry,
  rebuildClientBundles,
} from "./create-kumiko-server-client-bundles.ts";
import { broadcastReload, type DevReloadHub } from "./create-kumiko-server-reload.ts";
import { logInfo } from "./dev-server-runtime.ts";

export type DirectoryWatchEvents = (
  dir: string,
  options: { readonly recursive: true; readonly signal: AbortSignal },
) => AsyncIterable<{ readonly filename: string | null }>;

async function watchDir(
  dir: string,
  onChange: (filename: string) => void,
  signal: AbortSignal,
  watchEvents: DirectoryWatchEvents,
): Promise<void> {
  // The server's stop() aborts the signal; without it, the for-await loop
  // would continue until process exit. During test teardown, removing the
  // temporary directory could then be classified as a restart and call
  // process.exit(75), surfacing as an unhandled Vitest error.
  const watcher = watchEvents(dir, { recursive: true, signal });
  try {
    for await (const ev of watcher) {
      if (ev.filename) onChange(ev.filename);
    }
  } catch (err) {
    // signal.abort() causes the async iterator to throw AbortError during
    // expected teardown; other errors must propagate.
    // skip: AbortSignal fired the abort, this is expected teardown not a real error
    if (typeof err === "object" && err !== null && "name" in err && err.name === "AbortError")
      return;
    throw err;
  }
}

const WATCHED_SOURCE_SUFFIXES = [".ts", ".tsx"] as const;
const TEST_ONLY_SUFFIXES = [
  ".test.ts",
  ".test.tsx",
  ".integration.ts",
  ".integration.test.ts",
  ".e2e.ts",
] as const;
const CLIENT_SUBDIRS = ["web", "admin", "public", "client"] as const;
const CLIENT_ENTRY_SUFFIXES = ["/client.tsx", "/client.ts"] as const;

function endsWithAny(filename: string, suffixes: readonly string[]): boolean {
  return suffixes.some((suffix) => filename.endsWith(suffix));
}

function isTestOnlyFile(filename: string): boolean {
  return filename.includes("__tests__") || endsWithAny(filename, TEST_ONLY_SUFFIXES);
}

// Platform-independent: checks both POSIX and Windows separators. Matches
// `<sep><dir><sep>` and a leading `<dir><sep>` for watcher filenames
// supplied as relative paths.
function isInClientSubdir(filename: string): boolean {
  return CLIENT_SUBDIRS.some(
    (dir) =>
      filename.includes(`/${dir}/`) ||
      filename.includes(`\\${dir}\\`) ||
      filename.startsWith(`${dir}/`) ||
      filename.startsWith(`${dir}\\`),
  );
}

// Classifies a changed file as `hot-reload` for client-side changes,
// `restart` for server-side changes whose cached Bun modules must be
// reloaded, or `ignore` when the server is unaffected.
//
// Tests and non-TypeScript files are ignored. TypeScript files under
// `/web/`, `/admin/`, `/public/`, or `/client/`, as well as the client
// entry itself, trigger hot reload; other TypeScript files trigger a
// restart because they may contain schema or feature definitions.
//
// The multiple client directories are intentional: samples use different
// layouts. Restarting for a client-only edit would be slower, drop the
// ephemeral test database, and reseed it unnecessarily.
export function classifyChange(filename: string): "restart" | "hot-reload" | "ignore" {
  if (!endsWithAny(filename, WATCHED_SOURCE_SUFFIXES)) return "ignore";
  if (isTestOnlyFile(filename)) return "ignore";
  if (isInClientSubdir(filename) || endsWithAny(filename, CLIENT_ENTRY_SUFFIXES)) {
    return "hot-reload";
  }
  return "restart";
}

// The watcher reports paths relative to the watched directory, so an entry arrives as a bare
// "client.tsx" (or a custom name like "client-admin.tsx") that classifyChange alone reads as a
// server file and answers with a restart.
export function classifyWatchedChange(
  watchedDir: string,
  filename: string,
  entrySourceFiles: ReadonlySet<string>,
): ReturnType<typeof classifyChange> {
  return entrySourceFiles.has(resolve(watchedDir, filename))
    ? "hot-reload"
    : classifyChange(filename);
}

// Expands watchDirs patterns into concrete directories. Entries without
// `*` are resolved as ordinary paths; entries with `*` are glob-expanded
// and only directory matches are retained, so `"../../../packages/*/src"`
// replaces a list of hard-coded paths. Expansion runs once at boot,
// not while the watcher is running.
function expandWatchPatterns(patterns: readonly string[]): string[] {
  const out: string[] = [];
  for (const p of patterns) {
    if (!p.includes("*")) {
      out.push(resolve(p));
      continue;
    }
    // Only reachable under Bun (createKumikoServer is Bun-only); without Bun the
    // call stack fails fast in Bun.serve anyway.
    if (typeof Bun === "undefined") throw new Error("expandWatchPatterns requires Bun.Glob");
    const glob = new Bun.Glob(p);
    const matches = Array.from(glob.scanSync({ onlyFiles: false, cwd: process.cwd() }));
    for (const m of matches) {
      const abs = resolve(m);
      try {
        if (statSync(abs).isDirectory()) out.push(abs);
      } catch {
        // ignore unreadable matches, typically broken symlinks
      }
    }
  }
  return out;
}

export type DevFileWatcherDeps = {
  readonly entries: readonly NormalizedEntry[];
  readonly watchDirs: readonly string[] | undefined;
  readonly watchDirectory: DirectoryWatchEvents | undefined;
  readonly signal: AbortSignal;
  readonly buildBundle: ClientBundleBuilder;
  readonly clientBundles: Map<string, ClientBundle>;
  readonly reloadHub: DevReloadHub;
  readonly stop: () => Promise<void>;
};

// Because Bun caches module imports, a server-side change needs a process
// restart: exit code 75 (EX_TEMPFAIL) lets the `kumiko-dev` wrapper respawn.
async function handleWatchedChange(
  deps: DevFileWatcherDeps,
  dir: string,
  filename: string,
  entrySourceFiles: ReadonlySet<string>,
): Promise<void> {
  const action = classifyWatchedChange(dir, filename, entrySourceFiles);
  // skip: file change classified as ignore (test/css/json), nothing to rebuild
  if (action === "ignore") return;
  if (action === "restart") {
    logInfo(
      `[kumiko-server] schema change in ${filename} — restarting (Bun caches imports, hot-reload reicht hier nicht). ` +
        "The kumiko-dev wrapper (package.json's `dev` script) respawns automatically " +
        "and re-syncs new r.entity() columns on the new boot; running this entry " +
        "directly (not via kumiko-dev) exits here without restarting.",
    );
    await deps.stop();
    process.exit(75);
  }
  try {
    await rebuildClientBundles(deps.entries, deps.buildBundle, deps.clientBundles);
    logInfo(`[kumiko-server] rebuilt on ${filename}, broadcasting reload`);
    broadcastReload(deps.reloadHub, filename);
  } catch {
    // buildClient already logged the failure; keep serving the
    // last good bundle until the next successful rebuild.
  }
}

// Watches every entry directory plus the explicit watchDirs. Multi-entry
// setups often share one src/ directory, so the Set keeps one watcher per
// directory.
export function startDevFileWatchers(deps: DevFileWatcherDeps): void {
  // skip: without a client entry there is no bundle to rebuild, so watchDirs stay unwatched too
  if (deps.entries.length === 0) return;
  const entryDirs = new Set<string>();
  for (const e of deps.entries) entryDirs.add(resolve(e.sourceFile, ".."));
  const entrySourceFiles = new Set(deps.entries.map((e) => resolve(e.sourceFile)));
  const dirs = [...entryDirs, ...expandWatchPatterns(deps.watchDirs ?? [])];
  for (const dir of dirs) {
    void watchDir(
      dir,
      (filename) => handleWatchedChange(deps, dir, filename, entrySourceFiles),
      deps.signal,
      deps.watchDirectory ?? watch,
    );
  }
}
