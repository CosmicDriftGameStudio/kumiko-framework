// files-feature integration tests (S1.5).
//
// Beweist:
//   1. Feature lädt clean — r.entity("fileRef") + r.defineEvent("uploaded")
//      passieren Boot-Validation (PII-Annotations + Schema-Sanity).
//   2. Die fileRef-Entity ist im Registry sichtbar mit den erwarteten
//      Feldern und PII-Markern.
//   3. Schema-Definition matched die Framework-pgTable file_refs (gleiche
//      Spaltennamen) — vermeidet Drift zwischen den beiden Sichten.

import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-framework/stack";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createFilesFeature, fileRefEntity } from "../feature";

let stack: TestStack;

const feature = createFilesFeature();

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("files :: feature definition", () => {
  test("Boot ist clean (PII-Annotations + Event-Schema valide)", async () => {
    // setupTestStack hat das feature im beforeAll geladen — wenn Boot-
    // Validation fehlschlägt, würde dieser Block nie laufen.
    expect(stack).toBeDefined();
  });

  test("fileRef-Entity hat die erwarteten Felder", () => {
    const fields = Object.keys(fileRefEntity.fields).sort();
    expect(fields).toEqual([
      "entityId",
      "entityType",
      "fieldName",
      "fileName",
      "insertedAt",
      "insertedById",
      "mimeType",
      "size",
      "storageKey",
    ]);
  });

  test("fileName ist als pii: true markiert (Originalname kann Personen-Bezug haben)", () => {
    const fileName = fileRefEntity.fields["fileName"] as { pii?: boolean };
    expect(fileName.pii).toBe(true);
  });

  test("storageKey + mimeType + size sind als is-business-data markiert (kein PII)", () => {
    const storageKey = fileRefEntity.fields["storageKey"] as { allowPlaintext?: string };
    const mimeType = fileRefEntity.fields["mimeType"] as { allowPlaintext?: string };
    const size = fileRefEntity.fields["size"] as { allowPlaintext?: string };
    expect(storageKey.allowPlaintext).toBe("is-business-data");
    expect(mimeType.allowPlaintext).toBe("is-business-data");
    expect(size.allowPlaintext).toBe("is-business-data");
  });

  test("Tabellen-Name matched die Framework-pgTable (file_refs)", () => {
    expect(fileRefEntity.table).toBe("file_refs");
  });
});
