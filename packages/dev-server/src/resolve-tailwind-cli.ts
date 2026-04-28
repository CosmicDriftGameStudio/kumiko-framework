// Resolved den lokal installierten @tailwindcss/cli-Bin auf seinen
// absoluten Dateipfad. Wir vermeiden `bunx`, weil das auch bei lokal
// installiertem Package noch das Registry-Manifest fragt und ohne Netz
// mit `FailedToOpenSocket` stirbt.
//
// Ausgelagert aus create-kumiko-server.ts, damit unter vitest/Node
// testbar (Bun-Branch + Resolve-Fail-Branch) ohne den Server zu
// booten.

import { resolve } from "node:path";

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
