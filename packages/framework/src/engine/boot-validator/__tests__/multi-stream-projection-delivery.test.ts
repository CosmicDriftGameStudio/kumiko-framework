import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import { type SchemaTable, table, text } from "../../../db/dialect.ts";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

describe("MultiStreamProjection delivery", () => {
  const sinkTable = table("sink", { id: text("id").primaryKey() }) as unknown as SchemaTable;

  test("rejects delivery='per-instance' combined with a backing table", () => {
    const features = [
      defineFeature("sse", (r) => {
        r.multiStreamProjection({
          name: "broadcast",
          table: sinkTable,
          delivery: "per-instance",
          apply: { "some:event": async () => {} },
        });
      }),
    ];
    expect(() => validateBoot(features)).toThrow(
      /per-instance.+table.+duplicate INSERTs|cursor divergence/i,
    );
  });

  test("accepts delivery='per-instance' without a table (side-effect-only)", () => {
    const features = [
      defineFeature("sse", (r) => {
        r.multiStreamProjection({
          name: "broadcast",
          delivery: "per-instance",
          apply: { "some:event": async () => {} },
        });
      }),
    ];
    expect(() => validateBoot(features)).not.toThrow();
  });

  test("accepts delivery='shared' with a table (default, materialized read-model)", () => {
    const features = [
      defineFeature("reports", (r) => {
        r.multiStreamProjection({
          name: "rollup",
          table: sinkTable,
          delivery: "shared",
          apply: { "some:event": async () => {} },
        });
      }),
    ];
    expect(() => validateBoot(features)).not.toThrow();
  });
});
