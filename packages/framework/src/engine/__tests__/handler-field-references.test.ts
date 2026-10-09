import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { handlerFieldLabelKey, handlerTitleKey } from "../../i18n/required-surface-keys.js";
import { handlerFieldReference } from "../handler-field-references.js";

describe("handler i18n key helpers", () => {
  test("title and field label keys extend the handler QN", () => {
    expect(handlerTitleKey("channel-texts:write:generate")).toBe(
      "channel-texts:write:generate:title",
    );
    expect(handlerFieldLabelKey("channel-texts:write:generate", "vehicleId")).toBe(
      "channel-texts:write:generate:field:vehicleId",
    );
  });
});

describe("handlerFieldReference", () => {
  const meta = { references: "vehicle" };

  test("reads meta set directly on the field", () => {
    const schema = z.object({ vehicleId: z.string().meta(meta) });
    expect(handlerFieldReference(schema, "vehicleId")).toBe("vehicle");
  });

  test("finds meta when .optional() is applied afterwards", () => {
    const schema = z.object({ vehicleId: z.string().meta(meta).optional() });
    expect(handlerFieldReference(schema, "vehicleId")).toBe("vehicle");
  });

  test("finds meta set on the outer optional wrapper", () => {
    const schema = z.object({ vehicleId: z.string().optional().meta(meta) });
    expect(handlerFieldReference(schema, "vehicleId")).toBe("vehicle");
  });

  test("drills through nullable and default", () => {
    const schema = z.object({
      a: z.string().meta(meta).nullable(),
      b: z.string().meta(meta).default("x"),
    });
    expect(handlerFieldReference(schema, "a")).toBe("vehicle");
    expect(handlerFieldReference(schema, "b")).toBe("vehicle");
  });

  test("undefined without meta, for unknown fields and non-string values", () => {
    const schema = z.object({
      plain: z.string(),
      bad: z.string().meta({ references: 42 }),
    });
    expect(handlerFieldReference(schema, "plain")).toBeUndefined();
    expect(handlerFieldReference(schema, "missing")).toBeUndefined();
    expect(handlerFieldReference(schema, "bad")).toBeUndefined();
  });

  test("works through a wrapped object schema and is undefined for non-objects", () => {
    expect(handlerFieldReference(z.object({ v: z.string().meta(meta) }).nullable(), "v")).toBe(
      "vehicle",
    );
    expect(handlerFieldReference(z.string(), "v")).toBeUndefined();
  });
});
