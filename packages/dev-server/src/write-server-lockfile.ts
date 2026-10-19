// Pins dist-server/ to the dependency versions the app was tested with. The runtime image
// installs from dist-server/package.json, whose ranges alone resolve to whatever is newest
// on the registry at image-build time. Seeding the app's bun.lock keeps already-locked
// packages at their locked versions; packages the app lock does not carry resolve fresh.

import { existsSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export type WriteServerLockfileOptions = {
  /** App directory: the search for a seed bun.lock starts here and walks up. */
  readonly cwd: string;
  /** Server bundle directory holding the generated package.json. */
  readonly outDir: string;
};

export type ServerLockfileResult = { readonly lockfile: string } & (
  | { readonly mode: "seeded"; readonly seedLockfile: string }
  | { readonly mode: "resolved" }
);

function findSeedLockfile(startDir: string): string | undefined {
  let dir = resolve(startDir);
  for (;;) {
    const candidate = join(dir, "bun.lock");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export async function writeServerLockfile(
  options: WriteServerLockfileOptions,
): Promise<ServerLockfileResult> {
  const outDir = resolve(options.outDir);
  const lockfile = join(outDir, "bun.lock");
  const seedLockfile = findSeedLockfile(options.cwd);
  if (seedLockfile !== undefined) await copyFile(seedLockfile, lockfile);

  // process.execPath: the lock format has to match the Bun that built the bundle.
  const install = Bun.spawn({
    cmd: [process.execPath, "install", "--lockfile-only"],
    cwd: outDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    install.exited,
    new Response(install.stdout).text(),
    new Response(install.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `bun install --lockfile-only failed in ${outDir} (exit ${exitCode}); shipping dist-server without a lockfile would leave runtime versions unpinned.\n${stderr.trim() || stdout.trim()}`,
    );
  }
  if (!existsSync(lockfile)) {
    throw new Error(`bun install --lockfile-only did not write ${lockfile}`);
  }
  return seedLockfile === undefined
    ? { mode: "resolved", lockfile }
    : { mode: "seeded", seedLockfile, lockfile };
}
