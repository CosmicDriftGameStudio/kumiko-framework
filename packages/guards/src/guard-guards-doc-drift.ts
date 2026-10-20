#!/usr/bin/env bun
/**
 * Fails when docs/reference/guards.md differs from what the generator renders from the guard sources.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type RepoCheck, reportResults, runRepoChecks } from "./_lib/guard-kit";
import {
  GUARDS_DOC_REL,
  GUARDS_SRC_REL,
  hasGuardsSource,
  renderGuardsDoc,
} from "./_lib/guards-doc";

const REGENERATE_HINT = "run `bun run gen:guards-doc` and commit the result";

export const check: RepoCheck = {
  name: "guards-doc-drift",
  hint: "Run `bun run gen:guards-doc` and commit docs/reference/guards.md.",
  run(roots) {
    const frameworkRoots = roots.filter((root) => hasGuardsSource(root.absPath));
    const violations: { file: string; line: number; message: string }[] = [];
    for (const root of frameworkRoots) {
      const docPath = join(root.absPath, GUARDS_DOC_REL);
      const expected = renderGuardsDoc(root.absPath);
      if (!existsSync(docPath)) {
        violations.push({ file: GUARDS_DOC_REL, line: 1, message: `missing; ${REGENERATE_HINT}` });
      } else if (readFileSync(docPath, "utf-8") !== expected) {
        violations.push({
          file: GUARDS_DOC_REL,
          line: 1,
          message: `differs from the generated output (sources in ${GUARDS_SRC_REL}); ${REGENERATE_HINT}`,
        });
      }
    }
    return {
      violations,
      matchedFiles: frameworkRoots.length,
      notApplicable: frameworkRoots.length === 0,
    };
  },
};

if (import.meta.main) {
  const failed = reportResults(await runRepoChecks([check]));
  process.exit(failed > 0 ? 1 : 0);
}
