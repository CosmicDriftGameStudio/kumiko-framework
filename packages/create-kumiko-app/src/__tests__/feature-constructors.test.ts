// Guards against #1425/1: callExpression (rendered into generated
// run-config.ts) and callArgs (used at runtime by instantiateScaffoldFeatures)
// encode the same call twice by hand. If someone edits one without the
// other, the boot test validates a different feature config than what
// actually gets scaffolded. This derives the expected callExpression from
// exportName + callArgs for every entry and diffs it against the literal.

import { describe, expect, test } from "bun:test";
import { FEATURE_CONSTRUCTORS } from "../feature-constructors";

function expectedCallExpression(exportName: string, callArgs: readonly unknown[] | undefined): string {
  if (callArgs === undefined) {
    // Ambiguous by callArgs alone: could be a zero-arg factory (`fn()`) or a
    // bare object export (`fn`). Disambiguate the same way the runtime does
    // (scaffold-app.ts's instantiateScaffoldFeatures): trust the "()" the
    // literal itself carries, then only check the exportName prefix matches.
    return exportName;
  }
  const args = callArgs.map((a) => JSON.stringify(a)).join(", ");
  return `${exportName}(${args})`;
}

describe("FEATURE_CONSTRUCTORS callExpression/callArgs consistency", () => {
  for (const [name, entry] of Object.entries(FEATURE_CONSTRUCTORS)) {
    test(`${name}: callExpression matches exportName + callArgs`, () => {
      if (entry.callArgs !== undefined) {
        // callExpression is hand-formatted TS source (`{ scopes: {} }`), not
        // JSON (`{"scopes":{}}`) — compare with whitespace stripped so both
        // are checked against the same underlying arg values.
        const normalize = (s: string) => s.replace(/[\s"]+/g, "");
        expect(normalize(entry.callExpression)).toBe(
          normalize(expectedCallExpression(entry.exportName, entry.callArgs)),
        );
        return;
      }
      // No callArgs: either `exportName()` (zero-arg factory) or bare
      // `exportName` (object export) — both are legal, but the export name
      // itself must be the prefix either way.
      expect(entry.callExpression === entry.exportName || entry.callExpression === `${entry.exportName}()`).toBe(
        true,
      );
    });
  }
});
