import { afterEach, describe, expect, test } from "bun:test";
import { PII_CIPHERTEXT_PREFIX } from "@cosmicdrift/kumiko-framework/crypto";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import { readStoredDraft } from "../decrypt-draft.ts";

describe("readStoredDraft without a PII key service", () => {
  afterEach(() => {
    resetPiiSubjectKmsForTests();
  });

  test("a ciphertext draft throws instead of reading as empty", async () => {
    resetPiiSubjectKmsForTests();

    await expect(readStoredDraft(`${PII_CIPHERTEXT_PREFIX}anything`)).rejects.toThrow(
      "pii kms not configured",
    );
  });
});
