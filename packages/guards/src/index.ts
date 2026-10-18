export { AGENT_DOCS_DIR, renderAgentDocs, writeAgentDocs } from "./_lib/agent-docs";
export { gitEnv } from "./_lib/git-env";
export {
  type AstGuard,
  buildGuardKitInventory,
  buildSharedProject,
  cliFlagsError,
  explainGuards,
  filesForGuard,
  type GuardKitInventory,
  type GuardOutcome,
  type GuardViolation,
  isSecurityGuard,
  type RepoCheck,
  type RepoCheckOutcome,
  type RunGuardsDeps,
  type RunResult,
  reportResults,
  runGuards,
  runRepoChecks,
  type ScanSpec,
  type SuiteInventory,
} from "./_lib/guard-kit";
export { findLocalRepo, type RepoRoot, resolveRepoRoots } from "./_lib/roots";
export { type RootScan, type ScanOptions, scanFiles, scanRoots } from "./_lib/scan-scope";
export {
  loadSecurityBaseline,
  parseSecurityBaseline,
  SECURITY_BASELINE_FILE,
  type SecurityBaseline,
  type SecurityBaselineLoad,
} from "./_lib/security-baseline";
export { writeSecurityBaselines } from "./_lib/security-baseline-cli";
export { GUARD_FLAGS, GUARDS, runGuardsCli } from "./run-guards";
export { REPO_CHECK_FLAGS, REPO_CHECKS, runRepoChecksCli } from "./run-repo-checks";
export { runUiGuardsCli, UI_GUARD_FLAGS, UI_GUARDS } from "./run-ui-guards";
export { resolveImportTargetPath } from "./runtime-isolation-classify";
