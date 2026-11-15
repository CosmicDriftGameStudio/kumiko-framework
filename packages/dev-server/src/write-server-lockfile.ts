// Pins dist-server/ to the dependency versions the app was tested with. The runtime image
// installs from dist-server/package.json, whose ranges alone resolve to whatever is newest
// on the registry at image-build time. Seeding the app's bun.lock keeps already-locked
// packages at their locked versions; packages the app lock does not carry resolve fresh.
// When the seed carries every runtime dependency, the lock is written without registry access
// (build pods have no internet).

import { existsSync } from "node:fs";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseJsonOrThrow } from "@cosmicdrift/kumiko-framework/utils";
import * as z from "zod";

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

const runtimePackageSchema = z
  .object({ name: z.string(), dependencies: z.record(z.string(), z.string()).default({}) })
  .passthrough();

const lockSchema = z
  .object({
    workspaces: z.record(z.string(), z.unknown()),
    overrides: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

// The app lock carries the app's own root workspace, so bun would see the dist-server
// dependencies as changed and re-resolve them through registry manifests. With the root
// rewritten to dist-server's own dependencies, every locked package resolves from the lock
// alone; only packages missing from the app lock still need the registry. The other
// workspaces stay: their `workspace:` entries remain in `packages`, and dropping them makes a
// monorepo lock inconsistent so bun re-resolves everything. The lock's overrides stay too
// (they carry security pins for transitive packages) and move into package.json: bun compares
// the two, and a mismatch re-resolves through the registry and drops the pins.
async function rewriteSeedLockForRuntimePackage(lockfile: string, outDir: string): Promise<void> {
  const manifestPath = join(outDir, "package.json");
  const manifest = runtimePackageSchema.parse(
    parseJsonOrThrow<unknown>(await readFile(manifestPath, "utf8"), manifestPath),
  );
  const lock = lockSchema.parse(Bun.JSONC.parse(await readFile(lockfile, "utf8")));
  const rewritten = {
    ...lock,
    workspaces: {
      ...lock.workspaces,
      "": { name: manifest.name, dependencies: manifest.dependencies },
    },
  };
  await writeFile(lockfile, `${JSON.stringify(rewritten, null, 2)}\n`);
  if (lock.overrides !== undefined) {
    await writeFile(
      manifestPath,
      `${JSON.stringify({ ...manifest, overrides: lock.overrides }, null, 2)}\n`,
    );
  }
}

type BunRun = { readonly exitCode: number; readonly output: string };

async function runBun(args: readonly string[], cwd: string): Promise<BunRun> {
  // process.execPath: the lock format has to match the Bun that built the bundle.
  const proc = Bun.spawn({
    cmd: [process.execPath, ...args],
    cwd,
    // Bun.spawn reads the env from process start, so runtime changes to process.env (proxy,
    // cache dir) only reach the child when passed explicitly.
    env: process.env,
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
  if (seedLockfile !== undefined) {
    await copyFile(seedLockfile, lockfile);
    await rewriteSeedLockForRuntimePackage(lockfile, outDir);
  }

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
