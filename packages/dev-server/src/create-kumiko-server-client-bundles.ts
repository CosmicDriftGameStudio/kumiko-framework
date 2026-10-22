/// <reference types="bun-types" preserve="true" />
import { resolve } from "node:path";
import type { CreateKumikoServerOptions } from "./create-kumiko-server.ts";
import { hasBun, logError, logInfo } from "./dev-server-runtime.ts";

// Duplicated in packages/testing/src/e2e/constants.ts: the Playwright config
// runs under Node and cannot import this module.
export const PROD_BUNDLES_ENV = "KUMIKO_DEV_PROD_BUNDLES";

export type ClientBundle = {
  readonly js: string;
  readonly map: string;
  // Only set when PROD_BUNDLES_ENV builds with splitting. Path -> content,
  // e.g. "/chunk-abc123.js" -> "...".
  readonly chunks?: ReadonlyMap<string, string>;
};

export type ClientBundleBuilder = (sourceFile: string) => Promise<ClientBundle>;

export async function buildClient(entry: string): Promise<ClientBundle> {
  if (!hasBun) {
    throw new Error(
      "[kumiko-server] clientEntry is only supported under Bun — Bun.build is unavailable in this runtime.",
    );
  }
  const unminified = process.env["KUMIKO_DEV_UNMINIFIED"] === "1";
  // Same splitting/sourcemap/NODE_ENV as build-prod-bundle.ts, opt-in via
  // env so `bun dev` stays unchanged.
  const prodShaped = process.env[PROD_BUNDLES_ENV] === "1";
  const built = await Bun.build({
    entrypoints: [entry],
    target: "browser",
    minify: !unminified,
    sourcemap: prodShaped ? "none" : "linked",
    splitting: prodShaped,
    ...(prodShaped ? { define: { "process.env.NODE_ENV": JSON.stringify("production") } } : {}),
  });
  if (!built.success) {
    logError("[kumiko-server] client bundle failed:");
    for (const log of built.logs) logError(log);
    throw new Error("client bundle failed");
  }
  const jsOutput = built.outputs.find((o) => o.kind === "entry-point");
  const mapOutput = built.outputs.find((o) => o.path.endsWith(".js.map"));
  if (!jsOutput) throw new Error("[kumiko-server] client bundle produced no .js output");
  const chunks = new Map<string, string>();
  for (const output of built.outputs) {
    if (output.kind !== "chunk") continue;
    const chunkPath = `/${output.path.replace(/^\.\//, "")}`;
    chunks.set(chunkPath, await output.text());
  }
  return {
    js: await jsOutput.text(),
    map: mapOutput ? await mapOutput.text() : "",
    chunks,
  };
}

/** @internal — normalized client-entry form shared by single-entry
 *  (`clientEntry`) and multi-entry (`clientEntries`) modes. */
export type NormalizedEntry = {
  readonly name: string;
  readonly sourceFile: string;
  readonly htmlPath: string | undefined;
};

/** URL path used to serve an entry: `"client"` → `/client.js`
 *  (the single-entry default), otherwise `/client-<name>.js`. Keeping
 *  this in one place ensures routing and logging use the same convention. */
function assetPathFor(entryName: string): string {
  return entryName === "client" ? "/client.js" : `/client-${entryName}.js`;
}

export function normalizeEntries(options: CreateKumikoServerOptions): readonly NormalizedEntry[] {
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

// Each entry is served at GET /client[-name].js and its sourcemap at
// GET /client[-name].js.map.
export function indexBundlesByAssetPath(
  entries: readonly NormalizedEntry[],
): ReadonlyMap<string, string> {
  const bundleByAssetPath = new Map<string, string>();
  for (const e of entries) bundleByAssetPath.set(assetPathFor(e.name), e.name);
  return bundleByAssetPath;
}

export async function buildClientBundles(
  entries: readonly NormalizedEntry[],
  buildBundle: ClientBundleBuilder,
): Promise<Map<string, ClientBundle>> {
  const clientBundles = new Map<string, ClientBundle>();
  for (const e of entries) {
    const bundle = await buildBundle(e.sourceFile);
    clientBundles.set(e.name, bundle);
    logInfo(
      `[kumiko-server] client bundle ${e.name}: ${bundle.js.length.toLocaleString()} bytes` +
        (bundle.map ? ` (+ ${bundle.map.length.toLocaleString()} bytes sourcemap)` : ""),
    );
  }
  return clientBundles;
}

// Rebuilds every entry even when only one file changed, because we do not
// know which entries import it. A failing build throws and leaves the
// bundles replaced so far in place.
export async function rebuildClientBundles(
  entries: readonly NormalizedEntry[],
  buildBundle: ClientBundleBuilder,
  clientBundles: Map<string, ClientBundle>,
): Promise<void> {
  for (const e of entries) {
    const rebuilt = await buildBundle(e.sourceFile);
    clientBundles.set(e.name, rebuilt);
  }
}
