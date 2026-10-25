#!/usr/bin/env bun
/**
 * Every doc under docs/{plans,runbooks,migration,reference} needs valid status frontmatter.
 *
 * status and verified are required; shipped needs evidence, superseded needs superseded-by,
 * in-progress and blocked need next. Missing issue refs, finished plans outside the archive and
 * malformed depends refs are warnings.
 */
import { discoverStatusDocs, statusDocHygieneWarnings } from "./_lib/doc-status";
import { type RepoCheck, reportResults, runRepoChecks } from "./_lib/guard-kit";

export const check: RepoCheck = {
  name: "doc-status",
  hint: "Frontmatter schema: status + verified (YYYY-MM-DD); shipped → evidence, superseded → superseded-by, in-progress|blocked → next.",
  run(roots) {
    const docs = roots.flatMap((root) => discoverStatusDocs(root));
    return {
      violations: docs.flatMap((doc) =>
        doc.problems.map((message) => ({ file: doc.relPath, line: 1, message })),
      ),
      warnings: docs.flatMap((doc) =>
        statusDocHygieneWarnings(doc).map((message) => ({ file: doc.relPath, line: 1, message })),
      ),
      matchedFiles: docs.length,
      notApplicable: docs.length === 0,
    };
  },
};

if (import.meta.main) {
  const failed = reportResults(await runRepoChecks([check]));
  process.exit(failed > 0 ? 1 : 0);
}
