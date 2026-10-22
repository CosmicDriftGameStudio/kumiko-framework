// Resolves the locally installed @tailwindcss/cli binary to its absolute path.
// We avoid `bunx` because it still requests the registry manifest for a locally
// installed package and fails with `FailedToOpenSocket` when offline.
//
// Kept separate from create-kumiko-server.ts so the Bun and resolution-failure
// branches can be tested under Vitest/Node without booting the server.

import { dirname, resolve } from "node:path";

type BunResolver = { resolveSync: (id: string, from: string) => string };

export type ResolveTailwindCliDeps = {
  readonly bun?: BunResolver;
  readonly cwd: string;
};

export function resolveTailwindCli(deps: ResolveTailwindCliDeps): string | undefined {
  if (deps.bun === undefined) return undefined;
  try {
    const pkgJsonPath = deps.bun.resolveSync("@tailwindcss/cli/package.json", deps.cwd);
    // bin: { tailwindcss: "./dist/index.mjs" } → absoluter Pfad
    return resolve(pkgJsonPath, "..", "dist", "index.mjs");
  } catch {
    return undefined;
  }
}

/** Tailwind v4 resolves `@import "tailwindcss"` relative to the entry
 *  CSS file. Skip renderer-web fallback (or fail build) when peer deps
 *  aren't resolvable from that directory — e.g. Bun cache copies of
 *  `@cosmicdrift/kumiko-renderer/web` outside a hoisted node_modules tree. */
export function canResolveTailwindStylesheet(
  entryCss: string,
  deps: ResolveTailwindCliDeps,
): boolean {
  if (deps.bun === undefined) return false;
  try {
    deps.bun.resolveSync("tailwindcss", dirname(entryCss));
    return true;
  } catch {
    return false;
  }
}
