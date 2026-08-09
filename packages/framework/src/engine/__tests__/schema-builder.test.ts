import { describe, expect, test } from "bun:test";
import {
  createBooleanField,
  createDateField,
  createEmbeddedField,
  createEmbeddedListField,
  createEntity,
  createFileField,
  createFilesField,
  createImageField,
  createImagesField,
  createLocatedTimestampField,
  createMoneyField,
  createMultiSelectField,
  createNumberField,
  createSelectField,
  createTextField,
} from "../factories";
import { buildInsertSchema, buildUpdateSchema } from "../schema-builder";
import type { FieldDefinition } from "../types/fields";

type SchemaCase = {
  readonly name: string;
  readonly fields: Record<string, FieldDefinition>;
  readonly valid: Record<string, unknown> | null;
  readonly invalid: Record<string, unknown> | null;
};

// --- Field type → Zod mapping ---

describe("buildInsertSchema", () => {
  test.each<SchemaCase>([
    {
      name: "required text field",
      fields: { email: createTextField({ required: true }) },
      valid: { email: "test@test.de" },
      invalid: { email: "" },
    },
    {
      name: "optional text field",
      fields: { name: createTextField() },
      valid: {},
      invalid: null,
    },
    {
      name: "text field with maxLength",
      fields: { name: createTextField({ maxLength: 5 }) },
      valid: { name: "hello" },
      invalid: { name: "toolong" },
    },
    {
      name: "email format",
      fields: { email: createTextField({ required: true, format: "email" }) },
      valid: { email: "a@b.de" },
      invalid: { email: "not-an-email" },
    },
    {
      name: "boolean field",
      fields: { active: createBooleanField() },
      valid: { active: true },
      invalid: { active: "yes" },
    },
    {
      name: "boolean with default",
      fields: { active: createBooleanField({ default: true }) },
      valid: {},
      invalid: null,
    },
    {
      name: "select field",
      fields: { locale: createSelectField({ options: ["de", "en", "fr"] as const }) },
      valid: { locale: "de" },
      invalid: { locale: "xx" },
    },
    {
      name: "multiSelect field accepts subset",
      fields: { tags: createMultiSelectField({ options: ["red", "green", "blue"] as const }) },
      valid: { tags: ["red", "blue"] },
      invalid: { tags: ["yellow"] },
    },
    {
      name: "multiSelect field accepts empty array",
      fields: { tags: createMultiSelectField({ options: ["a", "b"] as const }) },
      valid: { tags: [] },
      invalid: null,
    },
    {
      name: "multiSelect with default",
      fields: {
        tags: createMultiSelectField({ options: ["a", "b", "c"] as const, default: ["a"] }),
      },
      valid: {},
      invalid: null,
    },
    {
      name: "required multiSelect rejects empty array",
      fields: {
        tags: createMultiSelectField({ options: ["a", "b"] as const, required: true }),
      },
      valid: { tags: ["a"] },
      invalid: { tags: [] },
    },
    {
      name: "required multiSelect rejects missing field",
      fields: {
        tags: createMultiSelectField({ options: ["a", "b"] as const, required: true }),
      },
      valid: { tags: ["b"] },
      invalid: {},
    },
    {
      name: "number field",
      fields: { age: createNumberField({ required: true }) },
      valid: { age: 25 },
      invalid: { age: "old" },
    },
    {
      name: "number field rejects below min",
      fields: { age: createNumberField({ min: 0 }) },
      valid: { age: 0 },
      invalid: { age: -1 },
    },
    {
      name: "number field rejects above max",
      fields: { age: createNumberField({ max: 100 }) },
      valid: { age: 100 },
      invalid: { age: 101 },
    },
    {
      name: "number field min+max bounds",
      fields: { age: createNumberField({ min: 1, max: 10 }) },
      valid: { age: 5 },
      invalid: { age: 11 },
    },
    {
      name: "integer field rejects a value outside Postgres int4 range (must 400, not crash the DB write)",
      fields: { attempt: createNumberField({ integer: true }) },
      valid: { attempt: 2147483647 },
      invalid: { attempt: 2147483648 },
    },
    {
      name: "integer field with explicit max narrower than int4 still enforces the explicit bound",
      fields: { displayOrder: createNumberField({ integer: true, max: 100 }) },
      valid: { displayOrder: 100 },
      invalid: { displayOrder: 101 },
    },
    {
      name: "date field",
      fields: { born: createDateField() },
      valid: { born: "2026-01-01" },
      invalid: { born: 12345 },
    },
  ])("$name", ({ fields, valid, invalid }) => {
    const entity = createEntity({ table: "Test", fields });
    const schema = buildInsertSchema(entity);

    if (valid) {
      expect(schema.safeParse(valid).success).toBe(true);
    }
    if (invalid) {
      expect(schema.safeParse(invalid).success).toBe(false);
    }
  });

  test("combines multiple fields into one schema", () => {
    const entity = createEntity({
      table: "Users",
      fields: {
        email: createTextField({ required: true, format: "email" }),
        firstName: createTextField(),
        isEnabled: createBooleanField({ default: true }),
        locale: createSelectField({ options: ["de", "en"] as const }),
      },
    });

    const schema = buildInsertSchema(entity);

    // Valid: only required field + rest optional
    const result = schema.safeParse({ email: "a@b.de" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data["isEnabled"]).toBe(true); // default applied
    }

    // Invalid: missing required field
    expect(schema.safeParse({}).success).toBe(false);

    // Invalid: wrong type
    expect(schema.safeParse({ email: "a@b.de", isEnabled: "nope" }).success).toBe(false);
  });

  // The four file-field variants. Pre-fix the schema was z.number() /
  // z.array(z.number()) — legacy of an era where fileRefs were serial-keyed.
  // After the UUID table-builder fix those schemas would have rejected every
  // valid UUID string, so the fix HAD to move in lockstep. Each test here
  // asserts the new UUID contract AND explicitly rejects the old number
  // shape, so a regression to z.number() would flip every test red.
  test("file field accepts UUID (fileRefId)", () => {
    const entity = createEntity({ table: "Test", fields: { contract: createFileField() } });
    const schema = buildInsertSchema(entity);
    expect(schema.safeParse({ contract: "00000000-0000-4000-8000-000000000001" }).success).toBe(
      true,
    );
    expect(schema.safeParse({ contract: 42 }).success).toBe(false);
    expect(schema.safeParse({ contract: "not-a-uuid" }).success).toBe(false);
  });

  test("image field accepts UUID (fileRefId)", () => {
    const entity = createEntity({ table: "Test", fields: { avatar: createImageField() } });
    const schema = buildInsertSchema(entity);
    expect(schema.safeParse({ avatar: "00000000-0000-4000-8000-000000000002" }).success).toBe(true);
    expect(schema.safeParse({ avatar: 1 }).success).toBe(false);
    expect(schema.safeParse({ avatar: "photo.jpg" }).success).toBe(false);
  });

  test("files field accepts array of UUIDs", () => {
    const entity = createEntity({ table: "Test", fields: { docs: createFilesField() } });
    const schema = buildInsertSchema(entity);
    expect(
      schema.safeParse({
        docs: ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"],
      }).success,
    ).toBe(true);
    expect(schema.safeParse({ docs: [1, 2, 3] }).success).toBe(false);
    expect(schema.safeParse({ docs: "00000000-0000-4000-8000-000000000001" }).success).toBe(false);
  });

  test("images field accepts array of UUIDs", () => {
    const entity = createEntity({ table: "Test", fields: { photos: createImagesField() } });
    const schema = buildInsertSchema(entity);
    expect(schema.safeParse({ photos: ["00000000-0000-4000-8000-000000000003"] }).success).toBe(
      true,
    );
    expect(schema.safeParse({ photos: [10, 20] }).success).toBe(false);
    expect(schema.safeParse({ photos: "nope" }).success).toBe(false);
  });

  test("money field accepts { amount, currency } object", () => {
    const entity = createEntity({
      table: "Test",
      fields: { price: createMoneyField({ required: true }) },
      defaultCurrency: "EUR",
    });
    const schema = buildInsertSchema(entity);
    expect(schema.safeParse({ price: { amount: 1250, currency: "EUR" } }).success).toBe(true);
    expect(schema.safeParse({ price: { amount: 99.99, currency: "USD" } }).success).toBe(true);
  });

  test("money field rejects invalid currency", () => {
    const entity = createEntity({
      table: "Test",
      fields: { price: createMoneyField() },
      defaultCurrency: "EUR",
    });
    const schema = buildInsertSchema(entity);
    expect(schema.safeParse({ price: { amount: 100, currency: "FAKE" } }).success).toBe(false);
  });

  test("money field rejects plain number", () => {
    const entity = createEntity({
      table: "Test",
      fields: { price: createMoneyField() },
      defaultCurrency: "EUR",
    });
    const schema = buildInsertSchema(entity);
    expect(schema.safeParse({ price: 1250 }).success).toBe(false);
  });

  test("money field with custom currencies", () => {
    const entity = createEntity({
      table: "Test",
      fields: { price: createMoneyField() },
      defaultCurrency: "BHD",
    });
    const customCurrencies = ["EUR", "USD", "BHD"] as const;
    const schema = buildInsertSchema(entity, customCurrencies);
    expect(schema.safeParse({ price: { amount: 500, currency: "BHD" } }).success).toBe(true);
    expect(schema.safeParse({ price: { amount: 500, currency: "GBP" } }).success).toBe(false);
  });

  test("required text rejects empty string", () => {
    const entity = createEntity({
      table: "Test",
      fields: { name: createTextField({ required: true }) },
    });
    const schema = buildInsertSchema(entity);
    expect(schema.safeParse({ name: "" }).success).toBe(false);
  });

  test("embedded field accepts object matching schema", () => {
    const entity = createEntity({
      table: "Test",
      fields: {
        address: createEmbeddedField({
          street: { type: "text", required: true },
          zip: { type: "text", required: true },
          city: { type: "text", required: true },
          country: { type: "text" },
        }),
      },
    });
    const schema = buildInsertSchema(entity);
    expect(
      schema.safeParse({
        address: { street: "Hauptstr. 1", zip: "10115", city: "Berlin" },
      }).success,
    ).toBe(true);
  });

  test("embedded field rejects missing required sub-field", () => {
    const entity = createEntity({
      table: "Test",
      fields: {
        address: createEmbeddedField({
          street: { type: "text", required: true },
          city: { type: "text", required: true },
        }),
      },
    });
    const schema = buildInsertSchema(entity);
    expect(schema.safeParse({ address: { street: "Hauptstr." } }).success).toBe(false);
  });

  test("embedded field rejects wrong sub-field type", () => {
    const entity = createEntity({
      table: "Test",
      fields: {
        address: createEmbeddedField({
          zip: { type: "number" },
        }),
      },
    });
    const schema = buildInsertSchema(entity);
    expect(schema.safeParse({ address: { zip: "not-a-number" } }).success).toBe(false);
    expect(schema.safeParse({ address: { zip: 10115 } }).success).toBe(true);
  });

  test("embedded field accepts optional sub-fields", () => {
    const entity = createEntity({
      table: "Test",
      fields: {
        address: createEmbeddedField({
          street: { type: "text", required: true },
          notes: { type: "text" },
        }),
      },
    });
    const schema = buildInsertSchema(entity);
    expect(schema.safeParse({ address: { street: "Main St" } }).success).toBe(true);
  });

  test("optional embedded field can be omitted", () => {
    const entity = createEntity({
      table: "Test",
      fields: {
        name: createTextField({ required: true }),
        address: createEmbeddedField({ street: { type: "text" } }),
      },
    });
    const schema = buildInsertSchema(entity);
    expect(schema.safeParse({ name: "Test" }).success).toBe(true);
  });

  test("required embedded field cannot be omitted", () => {
    const entity = createEntity({
      table: "Test",
      fields: {
        address: createEmbeddedField({ street: { type: "text" } }, { required: true }),
      },
    });
    const schema = buildInsertSchema(entity);
    expect(schema.safeParse({}).success).toBe(false);
  });

  test("embedded-list field validates every row against the schema", () => {
    const entity = createEntity({
      table: "Test",
      fields: {
        lines: createEmbeddedListField({
          accountId: { type: "text", required: true },
          amount: { type: "number", required: true },
          note: { type: "text" },
        }),
      },
    });
    const schema = buildInsertSchema(entity);
    expect(
      schema.safeParse({
        lines: [
          { accountId: "bank", amount: 100 },
          { accountId: "rent", amount: -100, note: "Januar" },
        ],
      }).success,
    ).toBe(true);
    // second row is missing `amount` — a per-row check the free jsonb field
    // this replaces could not make
    expect(
      schema.safeParse({ lines: [{ accountId: "bank", amount: 100 }, { accountId: "rent" }] })
        .success,
    ).toBe(false);
    expect(schema.safeParse({ lines: [{ accountId: "bank", amount: "100" }] }).success).toBe(false);
  });

  test("embedded-list field rejects a bare object", () => {
    const entity = createEntity({
      table: "Test",
      fields: { lines: createEmbeddedListField({ accountId: { type: "text", required: true } }) },
    });
    const schema = buildInsertSchema(entity);
    expect(schema.safeParse({ lines: { accountId: "bank" } }).success).toBe(false);
  });

  test("optional embedded-list accepts an empty list, required one does not", () => {
    const optional = buildInsertSchema(
      createEntity({
        table: "Test",
        fields: { lines: createEmbeddedListField({ accountId: { type: "text" } }) },
      }),
    );
    expect(optional.safeParse({ lines: [] }).success).toBe(true);
    expect(optional.safeParse({}).success).toBe(true);

    const required = buildInsertSchema(
      createEntity({
        table: "Test",
        fields: {
          lines: createEmbeddedListField({ accountId: { type: "text" } }, { required: true }),
        },
      }),
    );
    expect(required.safeParse({ lines: [] }).success).toBe(false);
    expect(required.safeParse({}).success).toBe(false);
    expect(required.safeParse({ lines: [{ accountId: "bank" }] }).success).toBe(true);
  });

  test("select sub-field accepts a listed option, rejects an unlisted string", () => {
    const entity = createEntity({
      table: "Test",
      fields: {
        lines: createEmbeddedListField({
          status: { type: "select", options: ["draft", "sent"], required: true },
        }),
      },
    });
    const schema = buildInsertSchema(entity);
    expect(schema.safeParse({ lines: [{ status: "sent" }] }).success).toBe(true);
    expect(schema.safeParse({ lines: [{ status: "archived" }] }).success).toBe(false);
  });

  test("reference sub-field accepts a UUID, rejects a non-UUID string", () => {
    const entity = createEntity({
      table: "Test",
      fields: {
        lines: createEmbeddedListField({
          productId: { type: "reference", entity: "product", required: true },
        }),
      },
    });
    const schema = buildInsertSchema(entity);
    expect(
      schema.safeParse({ lines: [{ productId: "550e8400-e29b-41d4-a716-446655440000" }] }).success,
    ).toBe(true);
    expect(schema.safeParse({ lines: [{ productId: "not-a-uuid" }] }).success).toBe(false);
  });

  test("minItems/maxItems bound an embedded list", () => {
    const entity = createEntity({
      table: "Test",
      fields: {
        lines: createEmbeddedListField(
          { accountId: { type: "text", required: true } },
          { minItems: 2, maxItems: 3 },
        ),
      },
    });
    const schema = buildInsertSchema(entity);
    expect(schema.safeParse({ lines: [{ accountId: "a" }] }).success).toBe(false);
    expect(schema.safeParse({ lines: [{ accountId: "a" }, { accountId: "b" }] }).success).toBe(
      true,
    );
    expect(
      schema.safeParse({
        lines: [{ accountId: "a" }, { accountId: "b" }, { accountId: "c" }],
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        lines: [{ accountId: "a" }, { accountId: "b" }, { accountId: "c" }, { accountId: "d" }],
      }).success,
    ).toBe(false);
  });

  test("money sub-field accepts signed integer minor units, rejects fractions", () => {
    const entity = createEntity({
      table: "Test",
      fields: {
        lines: createEmbeddedListField({
          accountId: { type: "text", required: true },
          amount: { type: "money", required: true },
        }),
      },
    });
    const schema = buildInsertSchema(entity);
    const line = (amount: number) => ({ lines: [{ accountId: "bank", amount }] });
    expect(schema.safeParse(line(100)).success).toBe(true);
    expect(schema.safeParse(line(-100)).success).toBe(true);
    expect(schema.safeParse(line(Number.MAX_SAFE_INTEGER)).success).toBe(true);
    // a fractional amount is the Euro-vs-Cent confusion the type exists to catch
    expect(schema.safeParse(line(10.5)).success).toBe(false);
    expect(schema.safeParse(line(Number.MAX_SAFE_INTEGER + 1)).success).toBe(false);
  });

  test("decimal sub-field bounds the value to its scale", () => {
    const entity = createEntity({
      table: "Test",
      fields: {
        items: createEmbeddedListField({
          qty: { type: "decimal", scale: 2, required: true },
        }),
      },
    });
    const schema = buildInsertSchema(entity);
    const row = (qty: number) => ({ items: [{ qty }] });
    expect(schema.safeParse(row(1.25)).success).toBe(true);
    expect(schema.safeParse(row(-3.5)).success).toBe(true);
    // float artifact of an in-scale computation must pass (same contract as
    // the top-level decimal field)
    expect(schema.safeParse(row(0.1 + 0.2)).success).toBe(true);
    expect(schema.safeParse(row(0.305)).success).toBe(false);
    // scaled by 10^2 this leaves the safe-integer range
    expect(schema.safeParse(row(Number.MAX_SAFE_INTEGER)).success).toBe(false);
  });

  test("tz field validates against the IANA zone list", () => {
    const entity = createEntity({
      table: "Test",
      fields: { zone: { type: "tz", required: true } },
    });
    const schema = buildInsertSchema(entity);
    expect(schema.safeParse({ zone: "Europe/Berlin" }).success).toBe(true);
    expect(schema.safeParse({ zone: "UTC" }).success).toBe(true);
    expect(schema.safeParse({ zone: "Mars/Phobos" }).success).toBe(false);
    expect(schema.safeParse({ zone: "" }).success).toBe(false);
  });

  test("locatedTimestamp validates its tz against the IANA zone list", () => {
    const entity = createEntity({
      table: "Test",
      fields: { pickup: createLocatedTimestampField({ required: true }) },
    });
    const schema = buildInsertSchema(entity);
    expect(
      schema.safeParse({ pickup: { at: "2026-04-03T10:00:00", tz: "Europe/Lisbon" } }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ pickup: { at: "2026-04-03T10:00:00", tz: "Mars/Phobos" } }).success,
    ).toBe(false);
  });

  // #1674: an untouched HTML <select> submits "" for its placeholder option.
  // An optional select without a default must treat "" as "not set" (null),
  // not reject it as an invalid enum value.
  test("optional select without default accepts empty string as unset (null)", () => {
    const entity = createEntity({
      table: "Test",
      fields: { locale: createSelectField({ options: ["de", "en", "fr"] as const }) },
    });
    const schema = buildInsertSchema(entity);
    const result = schema.safeParse({ locale: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data["locale"]).toBeNull();
    }
  });

  test("optional select without default still validates a real value", () => {
    const entity = createEntity({
      table: "Test",
      fields: { locale: createSelectField({ options: ["de", "en", "fr"] as const }) },
    });
    const schema = buildInsertSchema(entity);
    expect(schema.safeParse({ locale: "en" }).success).toBe(true);
    expect(schema.safeParse({ locale: "xx" }).success).toBe(false);
  });

  test("required select rejects empty string", () => {
    const entity = createEntity({
      table: "Test",
      fields: { locale: createSelectField({ options: ["de", "en"] as const, required: true }) },
    });
    const schema = buildInsertSchema(entity);
    expect(schema.safeParse({ locale: "" }).success).toBe(false);
  });

  // #1702: same ""-problem as #1674, but for a select WITH a default —
  // an untouched <select> sends "" and the default only kicks in for
  // undefined. "" maps to the default (a defaulted field is never unset).
  test("optional select with default accepts empty string and falls back to the default", () => {
    const entity = createEntity({
      table: "Test",
      fields: {
        locale: createSelectField({ options: ["de", "en", "fr"] as const, default: "de" }),
      },
    });
    const schema = buildInsertSchema(entity);
    const result = schema.safeParse({ locale: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data["locale"]).toBe("de");
    }
  });

  // Review-fix (kumiko-framework#1712): an optional select WITHOUT a default
  // normalizes an untouched <select> to null (see the "unset (null)" test
  // above). A client that reuses that null against a since-defaulted field
  // must fall back to the default too, not get rejected as an invalid enum
  // value the way a bare `null` previously was.
  test("optional select with default accepts null and falls back to the default", () => {
    const entity = createEntity({
      table: "Test",
      fields: {
        locale: createSelectField({ options: ["de", "en", "fr"] as const, default: "de" }),
      },
    });
    const schema = buildInsertSchema(entity);
    const result = schema.safeParse({ locale: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data["locale"]).toBe("de");
    }
  });

  test("optional select with default still validates a real value", () => {
    const entity = createEntity({
      table: "Test",
      fields: {
        locale: createSelectField({ options: ["de", "en"] as const, default: "de" }),
      },
    });
    const schema = buildInsertSchema(entity);
    expect(schema.safeParse({ locale: "en" }).success).toBe(true);
    expect(schema.safeParse({ locale: "xx" }).success).toBe(false);
  });

  // #1712: pin omitted-key + explicit undefined — ZodPipe/optin path for defaults
  test("optional select with default applies when key omitted or undefined", () => {
    const entity = createEntity({
      table: "Test",
      fields: {
        locale: createSelectField({ options: ["de", "en", "fr"] as const, default: "de" }),
      },
    });
    const schema = buildInsertSchema(entity);
    const omitted = schema.safeParse({});
    expect(omitted.success).toBe(true);
    if (omitted.success) expect(omitted.data["locale"]).toBe("de");
    const undef = schema.safeParse({ locale: undefined });
    expect(undef.success).toBe(true);
    if (undef.success) expect(undef.data["locale"]).toBe("de");
  });
});

// --- fw#1839: embedded-list timestamp sub-field ---

describe("embedded sub-field: timestamp", () => {
  test("accepts a valid ISO datetime, rejects an invalid string", () => {
    const entity = createEntity({
      table: "Test",
      fields: {
        lines: createEmbeddedListField({
          loggedAt: { type: "timestamp", required: true },
        }),
      },
    });
    const schema = buildInsertSchema(entity);
    expect(schema.safeParse({ lines: [{ loggedAt: "2026-08-06T10:00:00Z" }] }).success).toBe(true);
    expect(schema.safeParse({ lines: [{ loggedAt: "not-a-date" }] }).success).toBe(false);
    expect(schema.safeParse({ lines: [{ loggedAt: "2026-08-06" }] }).success).toBe(false);
  });
});

// --- fw#1839: totalsMatch cross-field validation (schema-level, shared by
// client form-controller and server write handler via the same
// z.object().safeParse() call) ---

describe("totalsMatch (fw#1839)", () => {
  function invoiceEntity() {
    return createEntity({
      table: "Invoices",
      fields: {
        total: createMoneyField({ required: true }),
        lines: createEmbeddedListField(
          { amount: { type: "money", required: true } },
          { totalsMatch: { amount: "total" } },
        ),
      },
      defaultCurrency: "EUR",
    });
  }

  test("accepts when the sum of line amounts (minor units) equals the sibling total (major units)", () => {
    const schema = buildInsertSchema(invoiceEntity());
    const result = schema.safeParse({
      total: { amount: 30, currency: "EUR" },
      lines: [{ amount: 1000 }, { amount: 2000 }],
    });
    expect(result.success).toBe(true);
  });

  test("rejects when the sum diverges from the sibling total, issue path is the embedded field name", () => {
    const schema = buildInsertSchema(invoiceEntity());
    const result = schema.safeParse({
      total: { amount: 30, currency: "EUR" },
      lines: [{ amount: 1000 }, { amount: 1500 }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join(".") === "lines")).toBe(true);
    }
  });

  test("update payload omitting the embedded list is not checked (nothing to sum)", () => {
    const schema = buildUpdateSchema(invoiceEntity());
    expect(schema.safeParse({ total: { amount: 30, currency: "EUR" } }).success).toBe(true);
  });

  test("update payload omitting the sibling total is not checked (nothing to compare against)", () => {
    const schema = buildUpdateSchema(invoiceEntity());
    expect(schema.safeParse({ lines: [{ amount: 1000 }, { amount: 1500 }] }).success).toBe(true);
  });
});

// --- kumiko-framework#1837: derived-cell server-side recomputation — the
// server is the authority for derived cells, a client value is overwritten
// with the recomputed one instead of merely checked against it. ---

describe("embedded-list derived cell recomputation (kumiko-framework#1837)", () => {
  function orderEntity() {
    return createEntity({
      table: "Orders",
      fields: {
        lines: createEmbeddedListField(
          {
            qty: { type: "number", required: true },
            price: { type: "number", required: true },
            amount: { type: "number", required: false },
          },
          { derived: { amount: { op: "multiply", from: ["qty", "price"] } } },
        ),
      },
    });
  }

  test("a matching client-sent derived cell parses through unchanged", () => {
    const schema = buildInsertSchema(orderEntity());
    const result = schema.safeParse({ lines: [{ qty: 3, price: 10, amount: 30 }] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data["lines"]).toEqual([{ qty: 3, price: 10, amount: 30 }]);
    }
  });

  test("a diverging client-sent derived cell is overwritten with the server-computed value, not rejected", () => {
    const schema = buildInsertSchema(orderEntity());
    const result = schema.safeParse({ lines: [{ qty: 3, price: 10, amount: 99 }] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data["lines"]).toEqual([{ qty: 3, price: 10, amount: 30 }]);
    }
  });

  test("a derived cell omitted from the payload is filled in server-side", () => {
    const schema = buildInsertSchema(orderEntity());
    const result = schema.safeParse({ lines: [{ qty: 3, price: 10 }] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data["lines"]).toEqual([{ qty: 3, price: 10, amount: 30 }]);
    }
  });

  test("a missing source for a multiply-derived cell leaves the cell unset rather than 0", () => {
    const entity = createEntity({
      table: "Orders",
      fields: {
        lines: createEmbeddedListField(
          {
            qty: { type: "number", required: true },
            price: { type: "number", required: false },
            amount: { type: "number", required: false },
          },
          { derived: { amount: { op: "multiply", from: ["qty", "price"] } } },
        ),
      },
    });
    const schema = buildInsertSchema(entity);
    const result = schema.safeParse({ lines: [{ qty: 3, amount: 30 }] });
    expect(result.success).toBe(true);
    if (result.success) {
      const row = (result.data["lines"] as readonly Record<string, unknown>[])[0];
      expect(row).toBeDefined();
      expect(Object.hasOwn(row as Record<string, unknown>, "amount")).toBe(false);
    }
  });

  test("an embedded-list field without `derived` leaves a client-sent value untouched", () => {
    const entity = createEntity({
      table: "Orders",
      fields: {
        lines: createEmbeddedListField({
          qty: { type: "number", required: true },
          amount: { type: "number", required: false },
        }),
      },
    });
    const schema = buildInsertSchema(entity);
    const result = schema.safeParse({ lines: [{ qty: 3, amount: 999 }] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data["lines"]).toEqual([{ qty: 3, amount: 999 }]);
    }
  });

  // --- kumiko-framework#1852: a fractional product on a money/decimal
  // target isn't representable by the target sub-field's strict
  // integer/scale validation — round to the target's declared precision
  // before it's written back, instead of rejecting the whole row. ---

  test("a fractional product on a money target is rounded to whole minor units (kaufmännisch)", () => {
    const entity = createEntity({
      table: "Orders",
      fields: {
        lines: createEmbeddedListField(
          {
            qty: { type: "decimal", scale: 2, required: true },
            price: { type: "money", required: true },
            amount: { type: "money", required: false },
          },
          { derived: { amount: { op: "multiply", from: ["qty", "price"] } } },
        ),
      },
    });
    const schema = buildInsertSchema(entity);
    // 12.34 * 187 = 2307.58 minor units — not representable by money's
    // integer constraint. Rounds up (half-away-from-zero would round .58
    // to .0 anyway, this just isn't a half-step case).
    const result = schema.safeParse({ lines: [{ qty: 12.34, price: 187 }] });
    expect(result.success).toBe(true);
    if (result.success) {
      const row = (result.data["lines"] as readonly Record<string, unknown>[])[0];
      expect(row?.["amount"]).toBe(2308);
    }
  });

  test("a negative product exactly on a half-step rounds away from zero, not toward it", () => {
    const entity = createEntity({
      table: "Orders",
      fields: {
        lines: createEmbeddedListField(
          {
            qty: { type: "decimal", scale: 1, required: true },
            price: { type: "money", required: true },
            amount: { type: "money", required: false },
          },
          { derived: { amount: { op: "multiply", from: ["qty", "price"] } } },
        ),
      },
    });
    const schema = buildInsertSchema(entity);
    // 2.5 * -923 = -2307.5 exactly. `Math.round(-2307.5)` alone would give
    // -2307 (rounds toward zero for negative .5); half-away-from-zero must
    // give -2308.
    const result = schema.safeParse({ lines: [{ qty: 2.5, price: -923 }] });
    expect(result.success).toBe(true);
    if (result.success) {
      const row = (result.data["lines"] as readonly Record<string, unknown>[])[0];
      expect(row?.["amount"]).toBe(-2308);
    }
  });

  test("a decimal target rounds correctly through the classic float half-step trap", () => {
    const entity = createEntity({
      table: "Orders",
      fields: {
        lines: createEmbeddedListField(
          {
            qty: { type: "decimal", scale: 3, required: true },
            price: { type: "number", required: true },
            amount: { type: "decimal", scale: 2, required: false },
          },
          { derived: { amount: { op: "multiply", from: ["qty", "price"] } } },
        ),
      },
    });
    const schema = buildInsertSchema(entity);
    // 1.005 * 1 === 1.005 as a JS number, but 1.005 * 100 is actually
    // 100.49999999999999 in float — naive Math.round would floor this to
    // 1.00 instead of the mathematically-correct 1.01.
    const result = schema.safeParse({ lines: [{ qty: 1.005, price: 1 }] });
    expect(result.success).toBe(true);
    if (result.success) {
      const row = (result.data["lines"] as readonly Record<string, unknown>[])[0];
      expect(row?.["amount"]).toBe(1.01);
    }
  });

  test("totalsMatch validates against the rounded derived values, not the raw fractional products", () => {
    const entity = createEntity({
      table: "Orders",
      fields: {
        total: createMoneyField({ required: true }),
        lines: createEmbeddedListField(
          {
            qty: { type: "decimal", scale: 1, required: true },
            price: { type: "money", required: true },
            amount: { type: "money", required: false },
          },
          {
            derived: { amount: { op: "multiply", from: ["qty", "price"] } },
            totalsMatch: { amount: "total" },
          },
        ),
      },
      defaultCurrency: "EUR",
    });
    const schema = buildInsertSchema(entity);
    // Each row's raw product is x.5 and rounds up by 1 minor unit: row 1 =
    // 2.5 * 923 = 2307.5 -> 2308; row 2 = 3.5 * 100 = 350.0 -> 350 exactly.
    // Sibling total must equal the sum of the ROUNDED amounts (26.58 EUR),
    // not the sum of the raw fractional products.
    const result = schema.safeParse({
      total: { amount: 26.58, currency: "EUR" },
      lines: [
        { qty: 2.5, price: 923 },
        { qty: 3.5, price: 100 },
      ],
    });
    expect(result.success).toBe(true);
  });

  test("a number-typed derived cell is left unrounded (unit-agnostic pass-through)", () => {
    const entity = createEntity({
      table: "Orders",
      fields: {
        lines: createEmbeddedListField(
          {
            qty: { type: "number", required: true },
            price: { type: "number", required: true },
            amount: { type: "number", required: false },
          },
          { derived: { amount: { op: "multiply", from: ["qty", "price"] } } },
        ),
      },
    });
    const schema = buildInsertSchema(entity);
    const result = schema.safeParse({ lines: [{ qty: 1.5, price: 2 }] });
    expect(result.success).toBe(true);
    if (result.success) {
      const row = (result.data["lines"] as readonly Record<string, unknown>[])[0];
      expect(row?.["amount"]).toBe(3);
    }
  });
});

// --- Update schema (all partial) ---

describe("buildUpdateSchema", () => {
  test("all fields are optional", () => {
    const entity = createEntity({
      table: "Users",
      fields: {
        email: createTextField({ required: true, format: "email" }),
        firstName: createTextField(),
        isEnabled: createBooleanField(),
      },
    });

    const schema = buildUpdateSchema(entity);

    // Empty update is valid
    expect(schema.safeParse({}).success).toBe(true);

    // Partial update is valid
    expect(schema.safeParse({ firstName: "Marc" }).success).toBe(true);

    // Still validates types
    expect(schema.safeParse({ isEnabled: "nope" }).success).toBe(false);
  });

  test("still validates format on provided fields", () => {
    const entity = createEntity({
      table: "Users",
      fields: { email: createTextField({ required: true, format: "email" }) },
    });

    const schema = buildUpdateSchema(entity);

    expect(schema.safeParse({ email: "valid@test.de" }).success).toBe(true);
    expect(schema.safeParse({ email: "not-email" }).success).toBe(false);
  });

  // #1674: clearing a previously-set optional select back to "unset" must
  // work through the update path too — "" from an untouched <select> maps to
  // an explicit `null`, not `undefined` (which would be dropped from the
  // changes payload and silently no-op instead of clearing).
  test("optional select accepts empty string as an explicit clear-to-null", () => {
    const entity = createEntity({
      table: "Test",
      fields: { locale: createSelectField({ options: ["de", "en"] as const }) },
    });

    const schema = buildUpdateSchema(entity);
    const result = schema.safeParse({ locale: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data["locale"]).toBeNull();
    }
  });

  test("omitting an optional select on update leaves it untouched", () => {
    const entity = createEntity({
      table: "Test",
      fields: { locale: createSelectField({ options: ["de", "en"] as const }) },
    });

    const schema = buildUpdateSchema(entity);
    const result = schema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.hasOwn(result.data, "locale")).toBe(false);
    }
  });

  // fw#1703: buildUpdateSchema never applies defaults for an OMITTED field —
  // omitting a field must leave it untouched. But an explicit `""` from an
  // untouched <select> is a submission, not an omission, and "a field with a
  // default is never unset" (same invariant the insert path documents at
  // #1702) — so "" must map to the field's default on update too, not clobber
  // an existing value to null.
  test("optional select with default on update: empty string falls back to the default", () => {
    const entity = createEntity({
      table: "Test",
      fields: {
        locale: createSelectField({ options: ["de", "en"] as const, default: "de" }),
      },
    });

    const schema = buildUpdateSchema(entity);
    const result = schema.safeParse({ locale: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data["locale"]).toBe("de");
    }
  });

  test("optional select with default on update: omitting the field leaves it untouched", () => {
    const entity = createEntity({
      table: "Test",
      fields: {
        locale: createSelectField({ options: ["de", "en"] as const, default: "de" }),
      },
    });

    const schema = buildUpdateSchema(entity);
    const result = schema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.hasOwn(result.data, "locale")).toBe(false);
    }
  });

  test("required select with default on update: empty string falls back to the default instead of a required-error", () => {
    const entity = createEntity({
      table: "Test",
      fields: {
        locale: createSelectField({
          options: ["de", "en"] as const,
          default: "de",
          required: true,
        }),
      },
    });

    const schema = buildUpdateSchema(entity);
    const result = schema.safeParse({ locale: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data["locale"]).toBe("de");
    }
  });
});
