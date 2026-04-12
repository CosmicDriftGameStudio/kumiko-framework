import { z } from "zod";
import type { EntityDefinition, FieldDefinition } from "./types";
import { DEFAULT_CURRENCIES } from "./types";

function fieldToZod(field: FieldDefinition, currencies: readonly string[]): z.ZodTypeAny {
  switch (field.type) {
    case "text": {
      let schema = z.string();
      if (field.maxLength) schema = schema.max(field.maxLength);
      if (field.format === "email") schema = schema.email();
      if (field.format === "url") schema = schema.url();
      if (field.required) schema = schema.min(1);
      return field.default !== undefined ? schema.default(field.default) : schema;
    }
    case "boolean": {
      const schema = z.boolean();
      return field.default !== undefined ? schema.default(field.default) : schema;
    }
    case "select": {
      const [first, ...rest] = field.options;
      if (!first) return z.string();
      const schema = z.enum([first, ...rest]);
      return field.default !== undefined ? schema.default(field.default) : schema;
    }
    case "number": {
      const schema = z.number();
      return field.default !== undefined ? schema.default(field.default) : schema;
    }
    case "money": {
      const [first, ...rest] = currencies;
      if (!first) throw new Error("No currencies configured");
      return z.object({
        amount: z.number(),
        currency: z.enum([first, ...rest]),
      });
    }
    case "date": {
      return z.string().date();
    }
    case "file":
    case "image": {
      // Single file: stores fileRefId as number
      return z.number();
    }
    case "files":
    case "images": {
      // Multi file: array of fileRefIds
      return z.array(z.number());
    }
  }
}

export function buildInsertSchema(
  entity: EntityDefinition,
  currencies: readonly string[] = [...DEFAULT_CURRENCIES],
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [name, field] of Object.entries(entity.fields)) {
    const zodField = fieldToZod(field, currencies);
    const hasDefault = "default" in field && field.default !== undefined;
    const isRequired = "required" in field && field.required === true;
    shape[name] = isRequired || hasDefault ? zodField : zodField.optional();
  }

  return z.object(shape);
}

export function buildUpdateSchema(
  entity: EntityDefinition,
  currencies: readonly string[] = [...DEFAULT_CURRENCIES],
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [name, field] of Object.entries(entity.fields)) {
    shape[name] = fieldToZod(field, currencies).optional();
  }

  return z.object(shape);
}
