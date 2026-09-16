/**
 * `--write-security-baseline`: freezes every security guard finding into a
 * committed per-repo baseline — a missing file must never mean "not scanned".
 */
import type { Project } from "ts-morph";
import { type AstGuard, filesForGuard } from "./guard-kit";
import { resolveRepoRoots } from "./roots";
import {
  buildSecurityBaseline,
  loadSecurityBaseline,
  locateFinding,
  writeSecurityBaseline,
} from "./security-baseline";

export function writeSecurityBaselines(guards: readonly AstGuard[], project: Project): void {
  const guardViolations = guards.map((guard) => ({
    guardName: guard.name,
    violations: guard.run(filesForGuard(project, guard)).violations,
  }));

  const roots = resolveRepoRoots();
  const cwd = process.cwd();

  // Load every repo's existing baseline (and validate it) before writing any
  // file — a hardFail marker for repo N must never be lost to an overwrite
  // that already ran for repos 1..N-1 while repo N's own baseline was broken.
  const hardFailByRepo = new Map<string, readonly string[]>();
  for (const root of roots) {
    const load = loadSecurityBaseline(root.name, root.absPath);
    if (load.kind === "invalid") {
      console.error(`  ✗ Security baseline ${load.file}: ${load.reason}`);
      process.exit(1);
    }
    hardFailByRepo.set(root.name, load.hardFail);
  }

  for (const root of roots) {
    const hardFail = hardFailByRepo.get(root.name) ?? [];
    const baseline = buildSecurityBaseline(root.name, guardViolations, roots, cwd, hardFail);
    const path = writeSecurityBaseline(baseline, root.absPath);
    console.log(`  Security baseline written: ${path} (total ${baseline.total})`);
    for (const guardName of hardFail) {
      const count = guardViolations
        .filter((gv) => gv.guardName === guardName)
        .flatMap((gv) => gv.violations)
        .filter((v) => locateFinding(v.file, roots, cwd)?.repo === root.name).length;
      if (count > 0) {
        console.warn(
          `  ! ${root.name}: ${count} findings from ${guardName} not frozen (hardFail) — the guard run blocks them`,
        );
      }
    }
  }
}
