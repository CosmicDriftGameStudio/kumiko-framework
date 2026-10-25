// Walks the whole real checkout, so it lives in the integration suite instead of the 5 s unit budget.
import { describe, expect, test } from "bun:test";
import { checkRootFloor, isSecurityGuard } from "../_lib/guard-kit";
import { resolveRepoRoots } from "../_lib/roots";
import { type ScanSpec, scanFiles, scanRoots } from "../_lib/scan-scope";
import { GUARDS } from "../run-guards";

describe("Vacuity floor against the real checkout", () => {
  // The floor is disk-based (RootScan.sourceSurface) — a
  // root with zero .ts/.tsx source files is a violation, one with source but
  // nothing under the guard's own narrowing is not. Against this repo's real
  // checkout every guard must end up with either real files or a legitimately
  // narrowed-to-zero result — never a silent floor violation nobody looks at.
  // Only file counts matter here: parsing every file through ts-morph pushed
  // this test past its 15 s budget on CI.
  test("every guard gets files or is legitimately empty", () => {
    const roots = resolveRepoRoots();
    expect(roots.length).toBeGreaterThan(0);
    const problems = GUARDS.flatMap((guard) => {
      const scans = scanRoots(guard.scan, roots);
      if (scans.length === 0) return [];
      const files = scanFiles(guard.scan, roots, { security: isSecurityGuard(guard) });
      if (files.length > 0) return [];
      const { violatingRoots } = checkRootFloor(guard, scans);
      return violatingRoots.length > 0 ? [{ name: guard.name, violatingRoots }] : [];
    });
    expect(problems).toEqual([]);
  });

  test("the local repo root provides a positive source surface and files for a source-scan spec", () => {
    const roots = resolveRepoRoots();
    expect(roots.length).toBeGreaterThan(0);
    const spec: ScanSpec = { scope: "source", extensions: ["ts", "tsx"] };
    const [scan] = scanRoots(spec, roots);
    expect(scan?.sourceSurface).toBeGreaterThan(0);
    expect(scan?.files.length).toBeGreaterThan(0);
  });
});
