// Resolves the locally installed @tailwindcss/cli binary to its absolute path.
// We avoid `bunx` because it still requests the registry manifest for a locally
// installed package and fails with `FailedToOpenSocket` when offline.

import { dirname, join } from "node:path";
import { type BunResolver, findInstalledPackageDir } from "./resolve-installed-package.ts";

export type ResolveTailwindCliDeps = {
  readonly bun?: BunResolver;
  readonly cwd: string;
};

export function resolveTailwindCli(deps: ResolveTailwindCliDeps): string | undefined {
  if (deps.bun === undefined) return undefined;
  const cliDir = findInstalledPackageDir("@tailwindcss/cli", deps.cwd);
  return cliDir === undefined ? undefined : join(cliDir, "dist", "index.mjs");
}

/** Tailwind v4 resolves `@import "tailwindcss"` relative to the entry CSS file, so
 *  tailwindcss must be installed above it (not just next to a Bun cache copy of renderer-web). */
export function canResolveTailwindStylesheet(
  entryCss: string,
  deps: ResolveTailwindCliDeps,
): boolean {
  return (
    deps.bun !== undefined &&
    findInstalledPackageDir("tailwindcss", dirname(entryCss)) !== undefined
  );
}
