// Real-path test: an in-memory project has files by construction and can't observe a broken scan, so part of this runs against this repo's own real source tree instead.
import { describe, expect, test } from "bun:test";
import {
  type AstGuard,
  buildSharedProject,
  checkRootFloor,
  classifyRun,
  filesForGuard,
  runGuards,
} from "../_lib/guard-kit";
import { resolveRepoRoots } from "../_lib/roots";
import { type ScanSpec, scanRoots } from "../_lib/scan-scope";
import { guard as adminApi } from "../guard-admin-api";
import { GUARDS } from "../run-guards";

describe("Vacuity-Floor — classifyRun (numeric assertScanned form)", () => {
  test("Globs ohne Treffer failen, fehlende Ziel-Repos nicht", () => {
    expect(classifyRun({ globCount: 4, matchedFiles: 0 })).toEqual({
      notApplicable: false,
      vacuous: true,
    });
    expect(classifyRun({ globCount: 0, matchedFiles: 0 })).toEqual({
      notApplicable: true,
      vacuous: false,
    });
    expect(classifyRun({ globCount: 4, matchedFiles: 1 })).toEqual({
      notApplicable: false,
      vacuous: false,
    });
  });
});

describe("Vacuity-Floor gegen echte Pfade", () => {
  test("die Guard-Liste ist ohne Seiteneffekt importierbar", () => {
    // Previously `import { GUARDS }` kicked off the whole suite (top-level
    // runGuards), so no test could touch the list.
    expect(GUARDS.length).toBeGreaterThan(5);
    expect(new Set(GUARDS.map((g) => g.name)).size).toBe(GUARDS.length);
  });

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
  }, 120_000);

  // infra#480 hardening: a guard whose `scan` resolution throws (an
  // authoring mistake, e.g. an unsupported glob) must not crash the shared
  // project build — only that guard's own run should fail.
  test("ein Guard mit werfender scan-Auflösung crasht den Build nicht, Geschwister laufen weiter", () => {
    const throwingGuard: AstGuard = {
      name: "undecidable-guard",
      get scan(): ScanSpec {
        throw new Error("scan resolution boom");
      },
      run: () => ({ violations: [] }),
    };
    const project = buildSharedProject([throwingGuard, adminApi]);
    expect(filesForGuard(project, adminApi).length).toBeGreaterThanOrEqual(0);

    const results = runGuards([throwingGuard, adminApi], project);
    const thrown = results.find((r) => r.name === throwingGuard.name);
    expect(thrown?.ok).toBe(false);
    expect(thrown?.error).toContain("scan resolution boom");
    const sibling = results.find((r) => r.name === adminApi.name);
    expect(sibling?.error).toBeUndefined();
  }, 120_000);

  test("der lokale Repo-Root liefert eine positive Source-Surface und Dateien für eine Source-Scan-Spec", () => {
    const roots = resolveRepoRoots();
    if (roots.length === 0) return;
    const spec: ScanSpec = { scope: "source", extensions: ["ts", "tsx"] };
    const [scan] = scanRoots(spec, roots);
    expect(scan?.sourceSurface).toBeGreaterThan(0);
    expect(scan?.files.length).toBeGreaterThan(0);
  }, 30_000);
});
