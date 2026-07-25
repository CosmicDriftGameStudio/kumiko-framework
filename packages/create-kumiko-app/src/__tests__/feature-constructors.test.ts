// Guards against #1425/1: callExpression (rendered into generated
// run-config.ts) and callArgs (used at runtime by instantiateScaffoldFeatures)
// encode the same call twice by hand. If someone edits one without the
// other, the boot test validates a different feature config than what
// actually gets scaffolded. This derives the expected callExpression from
// exportName + callArgs for every entry and diffs it against the literal.

import { describe, expect, test } from "bun:test";
import { FEATURE_CONSTRUCTORS } from "../feature-constructors";

// Renders a value as hand-written TS source (unquoted object keys, quoted
// string values) instead of JSON — JSON.stringify(1) and JSON.stringify("1")
// both survive a whitespace+quote-strip compare as "1", which would hide a
// string/number divergence between callExpression and callArgs. Rendering
// like this and normalizing whitespace only keeps that divergence visible.
function renderTsLiteral(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(renderTsLiteral).join(", ")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([key, val]) => `${key}: ${renderTsLiteral(val)}`,
    );
    return `{ ${entries.join(", ")} }`;
  }
  return JSON.stringify(value);
}

function expectedCallExpression(exportName: string, callArgs: readonly unknown[]): string {
  const args = callArgs.map(renderTsLiteral).join(", ");
  return `${exportName}(${args})`;
}

describe("FEATURE_CONSTRUCTORS callExpression/callArgs consistency", () => {
  for (const [name, entry] of Object.entries(FEATURE_CONSTRUCTORS)) {
    test(`${name}: callExpression matches exportName + callArgs`, () => {
      if (entry.callArgs !== undefined) {
        // callExpression is hand-formatted TS source; compare with
        // whitespace stripped only — NOT quotes, so a string arg ("1") vs.
        // a number arg (1) still diverges after normalize.
        const normalize = (s: string) => s.replace(/\s+/g, "");
        expect(normalize(entry.callExpression)).toBe(
          normalize(expectedCallExpression(entry.exportName, entry.callArgs)),
        );
        return;
      }
      // No callArgs: either `exportName()` (zero-arg factory) or bare
      // `exportName` (object export) — both are legal, but the export name
      // itself must be the prefix either way.
      expect(
        entry.callExpression === entry.exportName ||
          entry.callExpression === `${entry.exportName}()`,
      ).toBe(true);
    });
  }
});
