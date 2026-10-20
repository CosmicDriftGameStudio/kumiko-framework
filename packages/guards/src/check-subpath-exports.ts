#!/usr/bin/env bun
/**
 * A published package that ships `src/<feature>/web.ts` must list `./<feature>/web` in its
 * package.json `exports`; otherwise every standalone app build fails with "Could not resolve".
 * Only "web" is checked: seeding/testing/constants subpaths are often internal on purpose.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isPlainObject, propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { type RepoCheck, reportResults, runRepoChecks } from "./_lib/guard-kit";
import { type RepoRoot, resolveRepoRoots } from "./_lib/roots";

const SUBPATH_NAMES = ["web"] as const;

function readPublishedExportKeys(pkgDir: string): ReadonlySet<string> | undefined {
  const pkgJsonPath = join(pkgDir, "package.json");
  if (!existsSync(pkgJsonPath)) return undefined;
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
  } catch (error) {
    throw new Error(`${pkgJsonPath}: invalid JSON`, { cause: error });
  }
  // Without publishConfig.registry the package is never shipped, so subpath drift does not apply.
  const registry = propertyOf(propertyOf(manifest, "publishConfig"), "registry");
  if (typeof registry !== "string") return undefined;
  const exportsMap = propertyOf(manifest, "exports");
  return new Set(isPlainObject(exportsMap) ? Object.keys(exportsMap) : []);
}

export const check: RepoCheck = {
  name: "Subpath Exports",
  hint:
    "Add the missing subpath key to the package.json `exports` field, otherwise every " +
    'standalone app build fails with "Could not resolve" on that import.',
  run(roots: readonly RepoRoot[]) {
    const violations: { file: string; line: number; message: string }[] = [];
    let matchedFiles = 0;
    for (const root of roots) {
      const packagesDir = join(root.absPath, "packages");
      if (!existsSync(packagesDir)) continue;
      for (const entry of readdirSync(packagesDir)) {
        const pkgDir = join(packagesDir, entry);
        if (!statSync(pkgDir).isDirectory()) continue;
        const exportKeys = readPublishedExportKeys(pkgDir);
        const srcDir = join(pkgDir, "src");
        if (exportKeys === undefined || !existsSync(srcDir)) continue;
        matchedFiles++;
        for (const feature of readdirSync(srcDir)) {
          if (feature.startsWith("_")) continue;
          // An unpublished feature folder needs no subpath exports either.
          if (!statSync(join(srcDir, feature)).isDirectory()) continue;
          if (!exportKeys.has(`./${feature}`)) continue;
          for (const sub of SUBPATH_NAMES) {
            const file = `packages/${entry}/src/${feature}/${sub}.ts`;
            if (!existsSync(join(root.absPath, file)) || exportKeys.has(`./${feature}/${sub}`)) {
              continue;
            }
            violations.push({
              file,
              line: 1,
              message: `"./${feature}/${sub}" is missing in packages/${entry}/package.json exports`,
            });
          }
        }
      }
    }
    return { violations, matchedFiles, notApplicable: matchedFiles === 0 };
  },
};

if (import.meta.main) {
  const failed = reportResults(await runRepoChecks([check], resolveRepoRoots()));
  process.exit(failed > 0 ? 1 : 0);
}
