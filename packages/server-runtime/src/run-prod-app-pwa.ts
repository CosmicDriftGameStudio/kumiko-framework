import { join } from "node:path";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { createPwaShell, type PwaOptions, type PwaShell } from "./pwa.ts";
import { readStaticFile } from "./run-prod-app-static-files.ts";

// Both files are written by kumiko build next to index.html: manifest.json maps logical
// names to the hashed asset URLs, build-info.json carries the build id.
const BUILD_ASSET_MANIFEST_FILE = "manifest.json";
const BUILD_INFO_FILE = "build-info.json";

async function readJsonFile(path: string): Promise<unknown> {
  const file = await readStaticFile(path);
  if (!file) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(file.bytes));
  } catch {
    return undefined;
  }
}

function hashedAssetUrls(manifest: unknown): readonly string[] {
  if (!isPlainObject(manifest)) return [];
  return Object.values(manifest).filter(
    (url): url is string => typeof url === "string" && url.startsWith("/"),
  );
}

function buildIdOf(buildInfo: unknown): string {
  return isPlainObject(buildInfo) && typeof buildInfo["id"] === "string" ? buildInfo["id"] : "";
}

export async function loadProdPwaShell(
  pwa: PwaOptions | undefined,
  staticDir: string | undefined,
): Promise<PwaShell | undefined> {
  if (pwa === undefined) return undefined;
  if (staticDir === undefined) {
    throw new Error("[runProdApp] `pwa` needs `staticDir`: the HTML shell is served from there.");
  }
  const [assetManifest, buildInfo] = await Promise.all([
    readJsonFile(join(staticDir, BUILD_ASSET_MANIFEST_FILE)),
    readJsonFile(join(staticDir, BUILD_INFO_FILE)),
  ]);
  const appShellUrls = hashedAssetUrls(assetManifest);
  // Without build-info.json the hashed URLs still change with every build.
  return createPwaShell(pwa, { appShellUrls, buildToken: buildIdOf(buildInfo) });
}
