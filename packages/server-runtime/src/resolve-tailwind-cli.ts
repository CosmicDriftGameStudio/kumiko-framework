// Resolves the locally installed @tailwindcss/cli binary to its absolute path.
// We avoid `bunx` because it still requests the registry manifest for a locally
// installed package and fails with `FailedToOpenSocket` when offline.
//
// Kept separate from create-kumiko-server.ts so the Bun and resolution-failure
// branches can be tested under Vitest/Node without booting the server.

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

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
 *  `@cosmicdrift/kumiko-renderer/web` outside a hoisted node_modules tree.
 *
 *  Walks node_modules like Tailwind's own resolver instead of asking
 *  Bun.resolveSync: without a node_modules tree Bun auto-installs, and from
 *  1.4.4 on that also resolves tailwindcss next to such a cache copy, which
 *  Tailwind itself then cannot import. */
export function canResolveTailwindStylesheet(
  entryCss: string,
  deps: ResolveTailwindCliDeps,
): boolean {
  if (deps.bun === undefined) return false;
  for (let dir = dirname(entryCss); ; dir = dirname(dir)) {
    if (existsSync(join(dir, "node_modules", "tailwindcss", "package.json"))) return true;
    if (dirname(dir) === dir) return false;
  }
}
