import type { EventPiiSubject } from "@cosmicdrift/kumiko-types/handlers";
import * as z from "zod";

type StoredPiiFieldSchema<TField extends z.core.$ZodType> =
  undefined extends z.input<TField>
    ? null extends z.input<TField>
      ? z.ZodOptional<z.ZodNullable<z.ZodString>>
      : z.ZodOptional<z.ZodString>
    : null extends z.input<TField>
      ? z.ZodNullable<z.ZodString>
      : z.ZodString;

export type StoredEventPayloadShape<TShape extends z.ZodRawShape, TPiiKey extends keyof TShape> = Omit<
  TShape,
  TPiiKey
> & { [K in TPiiKey]: StoredPiiFieldSchema<TShape[K]> };

// Personal fields arrive in a projection apply as ciphertext, which the write-side schema rejects (format, length, enum).
export function storedEventPayloadSchema<
  TShape extends z.ZodRawShape,
  TPiiKey extends keyof TShape & string,
>(
  schema: z.ZodObject<TShape>,
  piiFields: Readonly<Record<TPiiKey, EventPiiSubject>>,
): z.ZodObject<StoredEventPayloadShape<TShape, TPiiKey>>;
export function storedEventPayloadSchema(
  schema: z.ZodObject<z.ZodRawShape>,
  piiFields: Readonly<Record<string, EventPiiSubject>>,
): z.ZodObject<z.ZodRawShape> {
  const storedShape: Record<string, z.ZodType> = {};
  for (const key of Object.keys(piiFields)) {
    const field = schema.shape[key];
    if (field === undefined) {
      throw new Error(`storedEventPayloadSchema: PII field "${key}" is not in the event schema`);
    }
    storedShape[key] = storedPiiFieldSchema(field);
  }
  return schema.extend(storedShape);
}

function storedPiiFieldSchema(field: z.core.$ZodType): z.ZodType {
  const acceptsUndefined = z.safeParse(field, undefined).success;
  const acceptsNull = z.safeParse(field, null).success;
  if (acceptsUndefined && acceptsNull) return z.string().nullish();
  if (acceptsUndefined) return z.string().optional();
  if (acceptsNull) return z.string().nullable();
  return z.string();
}
