import { basename } from "node:path";
import { findLocalRepo, localRepoDirName } from "./roots";

// A worktree's folder name proves nothing (`kumiko-*` siblings share prefixes), so it is judged by its canonical checkout's directory name.
function pushRootMatchesCliScope(pushRepoRoot: string, cliScope: string): boolean {
  if (basename(pushRepoRoot) === cliScope) return true;
  const local = findLocalRepo(pushRepoRoot);
  return local !== undefined && (local.name === cliScope || localRepoDirName(local) === cliScope);
}

// A push root left over from an earlier hook run or a debug session must not redirect a guard at the wrong repo, so it only counts when KUMIKO_CLI_SCOPE names it.
export function resolvePushRepoRoot(
  vars: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const cliScope = vars["KUMIKO_CLI_SCOPE"]?.trim();
  const pushRepoRoot = vars["KUMIKO_PUSH_REPO_ROOT"]?.trim();
  if (!cliScope || !pushRepoRoot) return undefined;
  if (!pushRootMatchesCliScope(pushRepoRoot, cliScope)) {
    console.error(
      `[push-root] KUMIKO_PUSH_REPO_ROOT="${pushRepoRoot}" does not match KUMIKO_CLI_SCOPE="${cliScope}" — ignoring inherited/stale push root.`,
    );
    return undefined;
  }
  return pushRepoRoot;
}
