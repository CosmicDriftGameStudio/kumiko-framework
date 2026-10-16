import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { handlerFieldLabelKey, handlerTitleKey } from "../../i18n/required-surface-keys.js";
import { handlerFieldReference, readHandlerFieldReference } from "../handler-field-references.js";

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
  const vehicleById = { entity: "vehicle", by: undefined, multiple: false };

  test("reads meta set directly on the field", () => {
    const schema = z.object({ vehicleId: z.string().meta(meta) });
    expect(handlerFieldReference(schema, "vehicleId")).toEqual(vehicleById);
  });

  test("finds meta when .optional() is applied afterwards", () => {
    const schema = z.object({ vehicleId: z.string().meta(meta).optional() });
    expect(handlerFieldReference(schema, "vehicleId")).toEqual(vehicleById);
  });

  test("finds meta set on the outer optional wrapper", () => {
    const schema = z.object({ vehicleId: z.string().optional().meta(meta) });
    expect(handlerFieldReference(schema, "vehicleId")).toEqual(vehicleById);
  });

  test("drills through nullable and default", () => {
    const schema = z.object({
      a: z.string().meta(meta).nullable(),
      b: z.string().meta(meta).default("x"),
    });
    expect(handlerFieldReference(schema, "a")).toEqual(vehicleById);
    expect(handlerFieldReference(schema, "b")).toEqual(vehicleById);
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
    expect(handlerFieldReference(z.object({ v: z.string().meta(meta) }).nullable(), "v")).toEqual(
      vehicleById,
    );
    expect(handlerFieldReference(z.string(), "v")).toBeUndefined();
  });

  test("object form carries the business key", () => {
    const schema = z.object({
      key: z.string().meta({ references: { entity: "channel", by: "key" } }),
    });
    expect(handlerFieldReference(schema, "key")).toEqual({
      entity: "channel",
      by: "key",
      multiple: false,
    });
  });

  test("object form without by references the id", () => {
    const schema = z.object({ id: z.string().meta({ references: { entity: "channel" } }) });
    expect(handlerFieldReference(schema, "id")).toEqual({
      entity: "channel",
      by: undefined,
      multiple: false,
    });
  });

  test("array with meta on the array is multiple", () => {
    const schema = z.object({
      keys: z.array(z.string()).meta({ references: { entity: "channel", by: "key" } }),
    });
    expect(handlerFieldReference(schema, "keys")).toEqual({
      entity: "channel",
      by: "key",
      multiple: true,
    });
  });

  test("array with meta on the element is multiple", () => {
    const schema = z.object({ ids: z.array(z.string().meta(meta)) });
    expect(handlerFieldReference(schema, "ids")).toEqual({ ...vehicleById, multiple: true });
  });

  test("optional array and meta outside the array wrapper", () => {
    const schema = z.object({
      a: z.array(z.string()).meta(meta).optional(),
      b: z.array(z.string()).optional().meta(meta),
      c: z.array(z.string().meta(meta).optional()).optional(),
    });
    for (const field of ["a", "b", "c"]) {
      expect(handlerFieldReference(schema, field)).toEqual({ ...vehicleById, multiple: true });
    }
  });

  test("malformed meta is undefined for the public reader but invalid for the boot reader", () => {
    const schema = z.object({
      noEntity: z.string().meta({ references: { by: "key" } }),
      badEntity: z.string().meta({ references: { entity: 3 } }),
      empty: z.string().meta({ references: "" }),
      badBy: z.string().meta({ references: { entity: "x", by: 1 } }),
    });
    for (const field of ["noEntity", "badEntity", "empty", "badBy"]) {
      expect(handlerFieldReference(schema, field)).toBeUndefined();
      expect(readHandlerFieldReference(schema, field).kind).toBe("invalid");
    }
    expect(readHandlerFieldReference(schema, "missing").kind).toBe("none");
  });
});
