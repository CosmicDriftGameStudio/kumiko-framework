import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { buildFewShotCorpus } from "@cosmicdrift/kumiko-dev-server";

// Without a floor the corpus drift check goes green again after every
// regeneration, even when a parser regression silently turns canonical
// features into legacy ones. Raise MIN_CANONICAL_COUNT / lower
// MAX_PARSE_ERROR_COUNT when the parser improves; never the other way round.
const MIN_CANONICAL_COUNT = 111;
const MAX_PARSE_ERROR_COUNT = 88;

const FRAMEWORK_REPO_ROOT = resolve(import.meta.dir, "../../../..");

describe("few-shot corpus ratchet over the framework's own features", () => {
  const corpus = buildFewShotCorpus({ repoRoot: FRAMEWORK_REPO_ROOT });
  const parseErrorCount = corpus.entries.reduce((sum, entry) => sum + entry.parseErrors.length, 0);

  test("canonical feature count does not fall below the floor", () => {
    expect(corpus.totals.canonical).toBeGreaterThanOrEqual(MIN_CANONICAL_COUNT);
  });

  test("total parse errors do not exceed the ceiling", () => {
    expect(parseErrorCount).toBeLessThanOrEqual(MAX_PARSE_ERROR_COUNT);
  });
});
