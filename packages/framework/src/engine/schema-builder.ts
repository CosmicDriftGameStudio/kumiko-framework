import { z } from "zod";
import { assertUnreachable } from "../utils";
import type { EmbeddedSubFieldDef, EntityDefinition, FieldDefinition } from "./types";
import { DEFAULT_CURRENCIES } from "./types";

function embeddedSubFieldToZod(subField: EmbeddedSubFieldDef): z.ZodTypeAny {
  switch (subField.type) {
    case "text":
      return subField.required ? z.string().min(1) : z.string();
    case "number":
      return z.number();
    case "boolean":
      return z.boolean();
    case "date":
      return z.string().date();
    default:
      assertUnreachable(subField.type, "embedded sub-field type");
  }
}

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
    case "embedded": {
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const [subName, subField] of Object.entries(field.schema)) {
        const zodSub = embeddedSubFieldToZod(subField);
        shape[subName] = subField.required ? zodSub : zodSub.optional();
      }
      return z.object(shape);
    }
    case "date": {
      return z.string().date();
    }
    case "timestamp": {
      // Wenn locatedBy gesetzt: Wall-Clock OHNE Offset (ISO-Datetime ohne `Z`).
      // Sonst: ISO-UTC-Datetime (mit `Z`). Beide werden über z.iso.datetime
      // gegen das ISO-8601-Schema validiert; die Präzision (mit/ohne Offset)
      // hängt von locatedBy ab.
      return field.locatedBy !== undefined ? z.iso.datetime({ local: true }) : z.iso.datetime();
    }
    case "tz": {
      // IANA-Zonenname. Validierung gegen Intl.supportedValuesOf("timeZone")
      // ist genau aber teuer (~600 Strings) — wir akzeptieren den freien
      // String und prüfen via try/catch im Boot-Validator (kommt in
      // späterer Iteration).
      return z.string().min(1);
    }
    case "locatedTimestamp": {
      // Combined Wall-Clock+TZ Object. Beim Write akzeptieren wir entweder
      // { at, tz } (typisch UI-Form, utc wird berechnet) oder { utc, tz }
      // (typisch Server-zu-Server, at wird berechnet). Beim Read liefert
      // der Read-Wrapper alle drei Felder (siehe Phase D in MIGRATION.md).
      //
      // Hier nur die Schema-Garantie: mindestens tz + (at ODER utc).
      const at = z.iso.datetime({ local: true });
      const tz = z.string().min(1);
      const utc = z.iso.datetime();
      return z.union([
        z.object({ at, tz, utc: utc.optional() }),
        z.object({ utc, tz, at: at.optional() }),
      ]);
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
    default:
      assertUnreachable(field, "field type");
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
    // Update schemas never apply defaults — a user that sends only
    // `{ title }` means "only change title"; zod defaults would silently
    // inject default values for every omitted field and clobber existing
    // data via the event-store-executor's `changes` payload.
    // Cast widens the discriminated union so destructure works for variants
    // without a `default` field; remainder is structurally a FieldDefinition.
    const { default: _default, ...stripped } = field as FieldDefinition & {
      default?: unknown;
    };
    shape[name] = fieldToZod(stripped as FieldDefinition, currencies).optional();
  }

  return z.object(shape);
}
