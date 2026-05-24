import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const KNOWN_REPO_NAMES = new Set([
  "kumiko-framework",
  "kumiko-enterprise",
  "kumiko-studio",
  "kumiko-platform",
  "publicstatus",
  "solon",
]);

export type CheckWorkContext = {
  readonly cwd: string;
  readonly gitWorktree: string | undefined;
  readonly localRepoName: string | undefined;
  readonly localRepoPath: string | undefined;
  readonly cliScope: string | undefined;
  readonly workspaceRoot: string;
};

export function gitWorktreeRoot(cwd: string): string | undefined {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf-8",
  });
  if (r.status !== 0) return undefined;
  const top = r.stdout.trim();
  return top.length > 0 ? resolve(top) : undefined;
}

function readPackageName(dir: string): string | undefined {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return undefined;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { name?: unknown };
    return typeof pkg.name === "string" ? pkg.name : undefined;
  } catch {
    return undefined;
  }
}

function findLocalKumikoRepo(
  cwd: string,
  gitWorktree: string | undefined,
): { readonly name: string; readonly absPath: string } | undefined {
  const candidates: string[] = [];
  if (gitWorktree) candidates.push(gitWorktree);
  let dir = cwd;
  for (let i = 0; i < 25; i++) {
    candidates.push(dir);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  for (const absPath of candidates) {
    const name = readPackageName(absPath);
    if (name && KNOWN_REPO_NAMES.has(name)) {
      return { name, absPath: resolve(absPath) };
    }
  }
  return undefined;
}

export function resolveWorkspaceRoot(cwd: string, installFallback: string): string {
  const env = process.env["KUMIKO_WORKSPACE_ROOT"];
  if (env) return resolve(env);

  let dir = cwd;
  for (let i = 0; i < 25; i++) {
    if (readPackageName(dir) === "cosmicdriftgamestudio") return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const local = findLocalKumikoRepo(cwd, gitWorktreeRoot(cwd));
  if (local) {
    const parent = dirname(local.absPath);
    if (readPackageName(parent) === "cosmicdriftgamestudio") return parent;
  }

  return resolve(installFallback);
}

export function resolveCheckWorkContext(
  cwd: string,
  installFallback: string,
): CheckWorkContext {
  const gitWorktree = gitWorktreeRoot(cwd);
  const local = findLocalKumikoRepo(cwd, gitWorktree);
  const scopeRaw = process.env["KUMIKO_CLI_SCOPE"]?.trim();
  return {
    cwd: resolve(cwd),
    gitWorktree,
    localRepoName: local?.name,
    localRepoPath: local?.absPath,
    cliScope: scopeRaw && scopeRaw.length > 0 ? scopeRaw : undefined,
    workspaceRoot: resolveWorkspaceRoot(cwd, installFallback),
  };
}

export function formatCheckWorkContext(ctx: CheckWorkContext): string {
  const lines = ["--- check work context ---", `  cwd:            ${ctx.cwd}`];
  if (ctx.gitWorktree) {
    lines.push(`  git worktree:   ${ctx.gitWorktree}`);
  }
  if (ctx.localRepoName && ctx.localRepoPath) {
    lines.push(`  local repo:     ${ctx.localRepoName}`);
    lines.push(`  local repo dir: ${ctx.localRepoPath}`);
  }
  lines.push(ctx.cliScope ? `  cli scope:      ${ctx.cliScope}` : "  cli scope:      (all repos)");
  lines.push(`  workspace root: ${ctx.workspaceRoot}`);
  lines.push("---");
  return lines.join("\n");
}
