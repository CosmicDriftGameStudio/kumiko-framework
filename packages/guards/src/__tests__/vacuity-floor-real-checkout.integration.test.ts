// Parses the whole real checkout, so it lives in the integration suite (15 s budget) instead of the 5 s unit budget.
import { describe, expect, test } from "bun:test";
import { buildSharedProject, checkRootFloor, filesForGuard } from "../_lib/guard-kit";
import { resolveRepoRoots } from "../_lib/roots";
import { scanRoots } from "../_lib/scan-scope";
import { GUARDS } from "../run-guards";

describe("Vacuity-Floor gegen den echten Checkout", () => {
  // infra#427/#789: the D4 floor is disk-based (RootScan.sourceSurface) — a
  // root with zero .ts/.tsx source files is a violation, one with source but
  // nothing under the guard's own narrowing is not. Against this repo's real
  // checkout every guard must end up with either real files or a legitimately
  // narrowed-to-zero result — never a silent floor violation nobody looks at.
  test("jeder Guard bekommt Dateien oder ist legitim leer", () => {
    const roots = resolveRepoRoots();
    if (roots.length === 0) return;
    const project = buildSharedProject(GUARDS, roots);
    const problems = GUARDS.flatMap((guard) => {
      const scans = scanRoots(guard.scan, roots);
      if (scans.length === 0) return [];
      const files = filesForGuard(project, guard, roots);
      if (files.length > 0) return [];
      const { violatingRoots } = checkRootFloor(guard, scans);
      return violatingRoots.length > 0 ? [{ name: guard.name, violatingRoots }] : [];
    });
    expect(problems).toEqual([]);
  });
});
