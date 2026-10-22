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

type BunRun = { readonly exitCode: number; readonly output: string };

async function runBun(args: readonly string[], cwd: string): Promise<BunRun> {
  // process.execPath: the lock format has to match the Bun that built the bundle.
  const proc = Bun.spawn({
    cmd: [process.execPath, ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, output: stderr.trim() || stdout.trim() };
}

export async function writeServerLockfile(
  options: WriteServerLockfileOptions,
): Promise<ServerLockfileResult> {
  const outDir = resolve(options.outDir);
  const lockfile = join(outDir, "bun.lock");
  const seedLockfile = findSeedLockfile(options.cwd);
  if (seedLockfile !== undefined) await copyFile(seedLockfile, lockfile);

  const install = await runBun(["install", "--lockfile-only"], outDir);
  if (install.exitCode !== 0) {
    throw new Error(
      `bun install --lockfile-only failed in ${outDir} (exit ${install.exitCode}); shipping dist-server without a lockfile would leave runtime versions unpinned.\n${install.output}`,
    );
  }
  // A seeded copy exists before the install, so file presence proves nothing: replay the
  // runtime stage's frozen install to catch a lock that never re-resolved for this package.json.
  const frozen = await runBun(
    ["install", "--production", "--frozen-lockfile", "--lockfile-only"],
    outDir,
  );
  if (frozen.exitCode !== 0) {
    throw new Error(
      `${lockfile} does not satisfy ${join(outDir, "package.json")} (frozen install exit ${frozen.exitCode}); the runtime image build would fail.\n${frozen.output}`,
    );
  }
  return seedLockfile === undefined
    ? { mode: "resolved", lockfile }
    : { mode: "seeded", seedLockfile, lockfile };
}
