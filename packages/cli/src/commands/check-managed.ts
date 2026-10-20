import type { Output } from "../output";

type ManagedFilesModule = typeof import("@cosmicdrift/kumiko-dev-server/managed-files");
type ManagedFileReport = ReturnType<ManagedFilesModule["checkManagedFiles"]>["files"][number];

const NOT_ADOPTED_NOTE =
  "kumiko.config.ts does not call defineAppConfig yet, so these findings are warnings; they fail the check once it does.";

function describeReport(report: ManagedFileReport): string {
  switch (report.state) {
    case "ok":
      return "matches";
    case "missing":
      return report.kind === "seed" ? "missing (app-owned seed from `kumiko new app`)" : "missing";
    case "differs":
      return "differs from the template (- template, + repo)";
    case "unmarked":
      return report.diff === undefined
        ? "matches but has no kumiko-managed marker"
        : "no kumiko-managed marker and differs from the template (- template, + repo)";
    case "local":
      return `local: ${report.reason}`;
    case "invalid":
      return report.message;
  }
}

function printIndented(out: Output, text: string): void {
  for (const line of text.split("\n")) out.log(`        ${line}`);
}

export async function runManagedCheckStep(
  out: Output,
  repoRoot: string,
  uiRoots: readonly string[],
): Promise<number> {
  const managed: ManagedFilesModule = await import("@cosmicdrift/kumiko-dev-server/managed-files");
  const facts = managed.resolveManagedAppFacts({ appRoot: repoRoot, uiRoots });
  const result = managed.checkManagedFiles(facts);
  const drift = result.files.filter(managed.isManagedDrift);
  const local = result.files.filter((report) => report.state === "local");
  const okCount = result.files.length - drift.length - local.length;
  out.log(`    ${okCount}/${result.files.length} managed file(s) match the installed template`);
  for (const error of result.errors) out.log(`    ✗ ${error}`);
  for (const report of local) out.log(`    ~ ${report.path}: ${describeReport(report)}`);
  for (const report of drift) {
    out.log(`    ${result.adopted ? "✗" : "!"} ${report.path}: ${describeReport(report)}`);
    if ((report.state === "differs" || report.state === "unmarked") && report.diff !== undefined) {
      printIndented(out, report.diff);
    }
  }
  if (drift.length > 0) {
    out.log("    Fix: kumiko sync-managed --write (files without a marker: add --adopt)");
    if (!result.adopted) out.log(`    ${NOT_ADOPTED_NOTE}`);
  }
  const driftFails = result.adopted && drift.length > 0;
  return driftFails || result.errors.length > 0 ? 1 : 0;
}
