import { describe, expect, test } from "vitest";
import {
  createBooleanField,
  createDateField,
  createEmbeddedField,
  createEntity,
  createFileField,
  createFilesField,
  createImageField,
  createImagesField,
  createMoneyField,
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
      name: "number field",
      fields: { age: createNumberField({ required: true }) },
      valid: { age: 25 },
      invalid: { age: "old" },
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

  test("file field accepts UUID (fileRefId)", () => {
    const entity = createEntity({ table: "Test", fields: { contract: createFileField() } });
    const schema = buildInsertSchema(entity);
    expect(schema.safeParse({ contract: "00000000-0000-4000-8000-000000000001" }).success).toBe(
      true,
    );
    // Pre-fix the schema was z.number() — 42 used to pass. The fix aligns
    // validation with the uuid entity-column; numbers are rejected now.
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
});
