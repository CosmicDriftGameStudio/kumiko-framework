// The image installs from this app's package.json. Seeding the repo bun.lock mirrors dev-server's
// writeServerLockfile (rewriteSeedLockForRuntimePackage), so transitive dependencies stay on the
// tested versions with their integrity hashes instead of resolving fresh from npm on every build.
// Bun builtins only: the deps stage has no workspace packages to import from.

import { join } from "node:path";

type SeededFiles = {
  readonly manifest: Record<string, unknown>;
  readonly lock: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

export function seedServiceLockfile(input: {
  readonly manifest: unknown;
  readonly lock: unknown;
}): SeededFiles {
  const { manifest, lock } = input;
  if (!isRecord(manifest) || typeof manifest["name"] !== "string") {
    throw new Error("seed-lockfile: package.json has no name");
  }
  const dependencies = manifest["dependencies"];
  if (!isStringRecord(dependencies)) {
    throw new Error("seed-lockfile: package.json dependencies is not a string map");
  }
  if (!isRecord(lock) || !isRecord(lock["workspaces"])) {
    throw new Error("seed-lockfile: bun.lock has no workspaces");
  }
  const { devDependencies: _devDependencies, ...runtimeManifest } = manifest;
  const overrides = lock["overrides"];
  return {
    manifest: isRecord(overrides) ? { ...runtimeManifest, overrides } : runtimeManifest,
    lock: {
      ...lock,
      workspaces: { ...lock["workspaces"], "": { name: manifest["name"], dependencies } },
    },
  };
}

export async function seedLockfileInDir(dir: string): Promise<void> {
  const manifestPath = join(dir, "package.json");
  const lockPath = join(dir, "bun.lock");
  const seeded = seedServiceLockfile({
    manifest: await Bun.file(manifestPath).json(),
    lock: Bun.JSONC.parse(await Bun.file(lockPath).text()),
  });
  await Bun.write(manifestPath, `${JSON.stringify(seeded.manifest, null, 2)}\n`);
  await Bun.write(lockPath, `${JSON.stringify(seeded.lock, null, 2)}\n`);
}

if (import.meta.main) await seedLockfileInDir(process.cwd());
