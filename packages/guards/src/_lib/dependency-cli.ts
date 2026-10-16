import { cliFlagsError } from "./guard-kit";
import { findLocalRepo } from "./roots";

export const DEPENDENCY_CHECK_FLAGS: readonly string[] = ["--report"];

export type DependencyCliInvocation =
  | { readonly ok: true; readonly repoRoot: string; readonly reportOnly: boolean }
  | { readonly ok: false; readonly exitCode: number };

/** Shared argv + repo resolution of the licenses/security/outdated subcommands. */
export function parseDependencyCli(
  subcommand: string,
  argv: readonly string[],
  cwd: string,
): DependencyCliInvocation {
  const flagsError = cliFlagsError(subcommand, argv, DEPENDENCY_CHECK_FLAGS);
  if (flagsError !== undefined) {
    console.error(flagsError);
    return { ok: false, exitCode: 1 };
  }
  const repo = findLocalRepo(cwd);
  if (!repo) {
    console.error(`  ${subcommand}: no Kumiko repo root found above ${cwd}.`);
    return { ok: false, exitCode: 1 };
  }
  return { ok: true, repoRoot: repo.absPath, reportOnly: argv.includes("--report") };
}
