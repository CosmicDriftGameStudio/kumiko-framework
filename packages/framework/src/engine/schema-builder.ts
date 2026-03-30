import { z } from "zod";
import type { EntityDefinition, FieldDefinition } from "./types";

function fieldToZod(field: FieldDefinition): z.ZodTypeAny {
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
    case "date": {
      return z.string().date();
    }
  }
}

export function buildInsertSchema(
  entity: EntityDefinition,
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [name, field] of Object.entries(entity.fields)) {
    const zodField = fieldToZod(field);
    const hasDefault = "default" in field && field.default !== undefined;
    shape[name] = field.required || hasDefault ? zodField : zodField.optional();
  }

  return z.object(shape);
}

export function buildUpdateSchema(
  entity: EntityDefinition,
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [name, field] of Object.entries(entity.fields)) {
    shape[name] = fieldToZod(field).optional();
  }

  return z.object(shape);
}
