import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Role } from "./commands/types";

/**
 * Detect the active role by walking up from `cwd` looking for marker
 * files:
 *
 *   - cosmicdriftgamestudio/ Parent (yarn-workspace root) → maintainer
 *   - kumiko-framework / kumiko-platform / kumiko-enterprise → maintainer
 *   - anything else with a kumiko-framework dependency → app-dev
 *   - no markers found → app-dev (safe default)
 *
 * `--as <role>` Override gewinnt immer.
 */
export function detectRole(cwd: string, argv: ReadonlyArray<string>): Role {
  const override = parseAsOverride(argv);
  if (override) return override;

  let dir = cwd;
  for (let i = 0; i < 20; i++) {
    if (existsSync(join(dir, ".cdgs-maintainer"))) return "maintainer";
    const pkg = readPackageJson(dir);
    if (pkg) {
      // Top-level workspace marker — cosmicdriftgamestudio/package.json
      if (pkg.name === "cosmicdriftgamestudio") return "maintainer";
      // Maintained sub-repos
      const maintainerRepos = [
        "kumiko-framework",
        "kumiko-platform",
        "kumiko-enterprise",
        "kumiko-studio",
        "publicstatus",
      ];
      if (typeof pkg.name === "string" && maintainerRepos.includes(pkg.name)) {
        return "maintainer";
      }
      // App that consumes kumiko-framework
      if (hasFrameworkDep(pkg)) return "app-dev";
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "app-dev";
}

function parseAsOverride(argv: ReadonlyArray<string>): Role | undefined {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--as") {
      const v = argv[i + 1];
      if (v === "maintainer" || v === "app-dev") return v;
    }
  }
  return undefined;
}

type PkgJson = { readonly name?: unknown; readonly dependencies?: unknown; readonly devDependencies?: unknown };

function readPackageJson(dir: string): PkgJson | undefined {
  const path = join(dir, "package.json");
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as PkgJson;
  } catch {
    return undefined;
  }
}

function hasFrameworkDep(pkg: PkgJson): boolean {
  const sources = [pkg.dependencies, pkg.devDependencies];
  for (const deps of sources) {
    if (deps && typeof deps === "object") {
      if ("@cosmicdrift/kumiko-framework" in deps) return true;
      if ("@cosmicdrift/kumiko-dev-server" in deps) return true;
    }
  }
  return false;
}
