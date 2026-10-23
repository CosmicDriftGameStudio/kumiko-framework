import { existsSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";

export type BunResolver = { readonly resolveSync: (id: string, from: string) => string };

export function packageNameOf(specifier: string): string {
  const segments = specifier.split("/");
  return specifier.startsWith("@") ? segments.slice(0, 2).join("/") : (segments[0] ?? specifier);
}

/** Walks node_modules upwards like Node does; returns the real path so transitive deps
 *  of an isolated-linker install are found as siblings. */
export function findInstalledPackageDir(packageName: string, fromDir: string): string | undefined {
  for (let dir = resolve(fromDir); ; dir = resolve(dir, "..")) {
    const packageDir = join(dir, "node_modules", packageName);
    if (existsSync(join(packageDir, "package.json"))) return realpathSync(packageDir);
    if (resolve(dir, "..") === dir) return undefined;
  }
}

const globalBun: BunResolver | undefined = typeof Bun !== "undefined" ? Bun : undefined;

/** Bun.resolveSync auto-installs from the registry (since 1.4.4) when no node_modules tree
 *  exists, so only call it for packages that are already installed. */
export function resolveInstalledSync(
  specifier: string,
  fromDir: string,
  bun: BunResolver | undefined = globalBun,
): string | undefined {
  if (bun === undefined) return undefined;
  if (findInstalledPackageDir(packageNameOf(specifier), fromDir) === undefined) return undefined;
  try {
    return bun.resolveSync(specifier, fromDir);
  } catch {
    return undefined;
  }
}
