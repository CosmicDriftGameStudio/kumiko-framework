// Read-only files an app's own build ships (fonts, templates). Declared in
// package.json `kumiko.assets: [{ name, source }]`; buildProdBundle copies
// them into dist/<BUNDLED_ASSETS_DIST_DIR>/, readBundledAsset() finds them in
// prod (the copy) and in dev (the declared source) behind one name. The one
// guarded place for this lookup — apps must not wire node:fs for it.

import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { isPlainObject, parseJsonOrThrow } from "@cosmicdrift/kumiko-framework/utils";

/** dist-relative folder holding the copied assets. The static file server
 *  refuses to serve it (see run-prod-app-static-files.ts) — assets are
 *  server-side inputs, not public URLs. */
export const BUNDLED_ASSETS_DIST_DIR = "kumiko-bundled-assets";

/** Allowlist for asset names; also rules out path segments. */
export const BUNDLED_ASSET_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export type BundledAssetDeclaration = {
  readonly name: string;
  /** Relative to the directory of the declaring package.json. */
  readonly source: string;
};

export type BundledAssetOptions = {
  /** App root (the dir holding dist/ and package.json). Default: process.cwd(). */
  readonly cwd?: string;
};

export function isValidBundledAssetName(name: string): boolean {
  return BUNDLED_ASSET_NAME_PATTERN.test(name) && !name.includes("..");
}

function assertValidBundledAssetName(name: string): void {
  if (!isValidBundledAssetName(name)) {
    throw new Error(
      `[kumiko assets] invalid asset name "${name}" — must match ${BUNDLED_ASSET_NAME_PATTERN} ` +
        `and contain no "..".`,
    );
  }
}

// Same two-line defense as the storage layer's resolveContainedPath.
function resolveContained(baseDir: string, relative: string, label: string): string {
  const base = resolve(baseDir);
  if (isAbsolute(relative)) {
    throw new Error(`[kumiko assets] ${label} "${relative}" must be relative to the package dir.`);
  }
  const filePath = resolve(join(base, relative));
  if (filePath !== base && !filePath.startsWith(base + sep)) {
    throw new Error(`[kumiko assets] ${label} "${relative}" escapes the package dir ${base}.`);
  }
  return filePath;
}

/** Absolute source path of a declaration, contained in `packageDir`. */
export function resolveBundledAssetSource(
  packageDir: string,
  declaration: BundledAssetDeclaration,
): string {
  return resolveContained(
    packageDir,
    declaration.source,
    `kumiko.assets["${declaration.name}"].source`,
  );
}

/** Reads and validates package.json `kumiko.assets`. Missing file or key → [];
 *  anything malformed throws, so a typo cannot silently drop a declared asset. */
export function readBundledAssetDeclarations(
  packageDir: string,
): readonly BundledAssetDeclaration[] {
  const pkgJsonPath = resolve(packageDir, "package.json");
  if (!existsSync(pkgJsonPath)) return [];
  const parsed = parseJsonOrThrow<unknown>(readFileSync(pkgJsonPath, "utf8"), pkgJsonPath);
  if (!isPlainObject(parsed)) return [];
  const kumiko = parsed["kumiko"];
  if (!isPlainObject(kumiko) || !("assets" in kumiko)) return [];
  const value = kumiko["assets"];
  if (!Array.isArray(value)) {
    throw new Error(`[kumiko assets] package.json "kumiko.assets" must be an array.`);
  }
  const seen = new Set<string>();
  return value.map((item, index) => {
    const declaration = parseDeclaration(item, index);
    if (seen.has(declaration.name)) {
      throw new Error(
        `[kumiko assets] duplicate "kumiko.assets[].name" "${declaration.name}" — names must be unique.`,
      );
    }
    seen.add(declaration.name);
    resolveBundledAssetSource(packageDir, declaration);
    return declaration;
  });
}

function parseDeclaration(item: unknown, index: number): BundledAssetDeclaration {
  if (!isPlainObject(item)) {
    throw new Error(`[kumiko assets] package.json "kumiko.assets[${index}]" must be an object.`);
  }
  const name = item["name"];
  const source = item["source"];
  if (typeof name !== "string") {
    throw new Error(
      `[kumiko assets] package.json "kumiko.assets[${index}].name" must be a string.`,
    );
  }
  assertValidBundledAssetName(name);
  if (typeof source !== "string" || source.length === 0) {
    throw new Error(
      `[kumiko assets] package.json "kumiko.assets[${index}].source" must be a non-empty string.`,
    );
  }
  return { name, source };
}

function findNearestPackageDir(from: string): string | undefined {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Absolute path of a declared asset: the built copy in prod, the declared
 *  source in dev. Throws for invalid, undeclared or missing assets. */
export function resolveBundledAsset(name: string, opts: BundledAssetOptions = {}): string {
  assertValidBundledAssetName(name);
  const cwd = resolve(opts.cwd ?? process.cwd());

  const built = resolveContained(join(cwd, "dist", BUNDLED_ASSETS_DIST_DIR), name, "asset name");
  if (existsSync(built)) return built;

  const packageDir = findNearestPackageDir(cwd);
  const declaration = packageDir
    ? readBundledAssetDeclarations(packageDir).find((d) => d.name === name)
    : undefined;
  if (packageDir === undefined || declaration === undefined) {
    throw new Error(
      `[kumiko assets] "${name}" is not a built asset and not declared in package.json "kumiko.assets".`,
    );
  }
  const source = resolveBundledAssetSource(packageDir, declaration);
  if (!existsSync(source)) {
    throw new Error(`[kumiko assets] source of "${name}" not found: ${source}`);
  }
  return source;
}

export async function readBundledAsset(
  name: string,
  opts: BundledAssetOptions = {},
): Promise<Uint8Array> {
  return readFile(resolveBundledAsset(name, opts));
}
