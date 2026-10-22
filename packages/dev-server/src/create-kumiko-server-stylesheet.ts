/// <reference types="bun-types" preserve="true" />
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  canResolveTailwindStylesheet,
  resolveTailwindCli,
} from "@cosmicdrift/kumiko-server-runtime/resolve-tailwind-cli";
import type { CreateKumikoServerOptions } from "./create-kumiko-server.ts";
import { hasBun, logError, logInfo } from "./dev-server-runtime.ts";

// Duplicated in packages/testing/src/e2e/constants.ts: the Playwright config
// runs under Node and cannot import this module.
export const STYLESHEET_WATCH_ENV = "KUMIKO_DEV_STYLESHEET_WATCH";

export type TailwindPipeline = { readonly outPath: string; readonly kill: () => void };

// Resolves the path to the Tailwind entry CSS:
//   - explicit string  → the resolved absolute path
//   - false            → CSS pipeline off (undefined)
//   - undefined + client entries:
//       1. the app's own src/styles.css (theme override) if present
//       2. else the default `@cosmicdrift/kumiko-renderer/web/styles.css` via package exports
//   - undefined + no client entry: undefined (no CSS needed)
//
// The src/styles.css auto-detection mirrors build-prod-bundle:resolveStylesheetEntry
// so dev and prod resolve identically. Without it every app would have to set
// `stylesheet: "./src/styles.css"`, or dev would fall back to the default and
// ignore the brand tokens.
export function resolveStylesheet(options: CreateKumikoServerOptions): string | undefined {
  if (options.stylesheet === false) return undefined;
  if (typeof options.stylesheet === "string") return resolve(options.stylesheet);
  const hasAnyEntry =
    options.clientEntry !== undefined ||
    (options.clientEntries !== undefined && options.clientEntries.length > 0);
  if (!hasAnyEntry) return undefined;

  // The app's own src/styles.css beats the renderer/web default, same as
  // kumiko-build, so local and prod builds match.
  const local = resolve(process.cwd(), "src/styles.css");
  if (existsSync(local)) return local;

  // Bun.resolveSync follows package exports: `"./styles.css"` in
  // renderer/web's package.json resolves to the workspace file in the
  // monorepo or the node_modules file in an installed app. Bun already
  // returns an absolute filesystem path, so `fileURLToPath` is unnecessary.
  if (!hasBun) {
    // Node-based unit tests reach this branch. Without Bun, package-export
    // resolution and a real Tailwind pipeline are unavailable, so skip
    // silently rather than reporting an error.
    return undefined;
  }
  try {
    const resolved = Bun.resolveSync("@cosmicdrift/kumiko-renderer/web/styles.css", process.cwd());
    if (!canResolveTailwindStylesheet(resolved, { bun: Bun, cwd: process.cwd() })) {
      return undefined;
    }
    return resolved;
  } catch (err) {
    logError(
      "[kumiko-server] couldn't auto-resolve @cosmicdrift/kumiko-renderer/web/styles.css — " +
        "pass `stylesheet: <path>` or `stylesheet: false` explicitly.",
      err,
    );
    return undefined;
  }
}

// The E2E template can only reach an app's own server entry through its env,
// so the env has to count whenever the option is left undefined.
//
// @internal — exported for unit tests only, not re-exported from the index.
export function resolveStylesheetWatch(
  options: Pick<CreateKumikoServerOptions, "stylesheetWatch">,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (options.stylesheetWatch !== undefined) return options.stylesheetWatch;
  return env[STYLESHEET_WATCH_ENV] !== "0";
}

function runTailwindOneShotBuild(
  bunPath: string,
  cliPath: string,
  entryCss: string,
  outPath: string,
): Promise<void> {
  return new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(bunPath, ["run", cliPath, "-i", entryCss, "-o", outPath], {
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`tailwind one-shot-build exit ${code}`));
    });
    child.on("error", rejectPromise);
  });
}

// unref() so the watcher cannot outlive a crashed parent as an orphan.
function spawnTailwindWatcher(
  bunPath: string,
  cliPath: string,
  entryCss: string,
  outPath: string,
): () => void {
  const watcher = spawn(bunPath, ["run", cliPath, "-i", entryCss, "-o", outPath, "--watch"], {
    stdio: "inherit",
  });
  watcher.unref();
  return () => {
    try {
      watcher.kill("SIGTERM");
    } catch {
      // Already stopped or never started; no further action is needed.
    }
  };
}

// Non-fatal by design (returns undefined): if the CLI can't be resolved or
// the initial build fails (flaky network, missing dependency), the server
// boots without CSS instead of dying.
async function startTailwindPipeline(
  entryCss: string,
  { watch }: { readonly watch: boolean },
): Promise<TailwindPipeline | undefined> {
  const bunResolver = hasBun ? Bun : undefined;
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
  logInfo(
    watch
      ? `[kumiko-server] tailwind watcher → ${outPath}`
      : `[kumiko-server] tailwind one-shot build → ${outPath}`,
  );
  const bunPath = process.argv[0] ?? "bun";
  // Wait for the initial build so the first /styles.css request does not
  // return 404; only then does the watcher take over.
  try {
    await runTailwindOneShotBuild(bunPath, cliPath, entryCss, outPath);
  } catch (err) {
    logError("[kumiko-server] tailwind one-shot-build fehlgeschlagen — booting ohne CSS:", err);
    return undefined;
  }
  if (!watch) {
    return { outPath, kill: () => {} };
  }
  return { outPath, kill: spawnTailwindWatcher(bunPath, cliPath, entryCss, outPath) };
}

// The Tailwind CLI writes to a temp file that every /styles.css request reads
// fresh: no in-memory signalling needed, and the browser only reloads after a
// bundle rebuild anyway.
export async function startDevStylesheet(
  options: CreateKumikoServerOptions,
): Promise<TailwindPipeline | undefined> {
  const resolvedStylesheet = resolveStylesheet(options);
  if (resolvedStylesheet === undefined) return undefined;
  return startTailwindPipeline(resolvedStylesheet, { watch: resolveStylesheetWatch(options) });
}
