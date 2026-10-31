import { describe, expect, test } from "bun:test";
import { documentIngestProgressPayloadSchema } from "../events.ts";

describe("documentIngestProgressPayloadSchema", () => {
  test("accepts a partial and a complete count", () => {
    expect(
      documentIngestProgressPayloadSchema.safeParse({ fileRefId: "f", pagesDone: 0, pagesTotal: 3 })
        .success,
    ).toBe(true);
    expect(
      documentIngestProgressPayloadSchema.safeParse({ fileRefId: "f", pagesDone: 3, pagesTotal: 3 })
        .success,
    ).toBe(true);
  });

  test("rejects pagesDone above pagesTotal", () => {
    expect(
      documentIngestProgressPayloadSchema.safeParse({ fileRefId: "f", pagesDone: 4, pagesTotal: 3 })
        .success,
    ).toBe(false);
  });

  test("rejects pagesTotal 0", () => {
    expect(
      documentIngestProgressPayloadSchema.safeParse({ fileRefId: "f", pagesDone: 0, pagesTotal: 0 })
        .success,
    ).toBe(false);
  });
});
