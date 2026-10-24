import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";

export const CODEMOD_SUBDIR = "scripts/codemod";

export const CODEMOD_PACKAGE_NAME = "@cosmicdrift/kumiko-feature-ast";

export type UpgradeCliOut = {
  readonly log: (line: string) => void;
  readonly err: (line: string) => void;
};

export function findFeatureChangelogFiles(featuresDir: string): string[] {
  if (!existsSync(featuresDir)) return [];

  const files: string[] = [];
  const features = readdirSync(featuresDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const name of features) {
    // Layout is detected per-package, not guessed from a naming convention:
    // enterprise packages keep changes.json under src/, framework's
    // bundled-features keep it flat. A name-prefix heuristic (e.g. "ai-*")
    // silently drops packages that don't match it.
    const srcLayout = join(featuresDir, name, "src", "changes.json");
    const flatLayout = join(featuresDir, name, "changes.json");
    const changelogPath = existsSync(srcLayout) ? srcLayout : flatLayout;
    if (existsSync(changelogPath)) files.push(changelogPath);
  }

  return files;
}

// Consumer-facing codemod scripts ship inside the published
// @cosmicdrift/kumiko-feature-ast package (src/scripts/codemod), not at the
// git repo root — only the installed package path exists in a consumer's
// node_modules after a plain npm/bun install.
export function findCodemodScriptsRoot(repoRoot: string): string | null {
  const local = join(repoRoot, "packages/feature-ast/src");
  if (existsSync(join(local, CODEMOD_SUBDIR))) {
    // If package.json exists, require it to be kumiko-feature-ast so a generic
    // monorepo `packages/feature-ast` cannot shadow the installed package.
    // Missing package.json (test fixtures / incomplete trees) keeps prior behavior.
    const pkgPath = join(repoRoot, "packages/feature-ast/package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg: unknown = JSON.parse(readFileSync(pkgPath, "utf8"));
        if (propertyOf(pkg, "name") === CODEMOD_PACKAGE_NAME) return local;
        // wrong name → fall through
      } catch {
        // unreadable → fall through
      }
    } else {
      return local;
    }
  }

  let dir = repoRoot;
  for (let i = 0; i < 10; i++) {
    const nmSrc = join(dir, "node_modules", CODEMOD_PACKAGE_NAME, "src");
    if (existsSync(join(nmSrc, CODEMOD_SUBDIR))) return nmSrc;
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}
