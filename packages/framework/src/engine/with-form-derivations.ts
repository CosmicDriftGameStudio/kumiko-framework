import * as z from "zod";
import { applyFormDerivations, type FormDerivationScreen } from "./form-derivations.ts";
import type { FormFieldDerivation } from "./types/screen.ts";

const derivationsBySchema = new WeakMap<z.ZodType, Readonly<Record<string, FormFieldDerivation>>>();

/** The `derive` a schema was wrapped with via `withFormDerivations`, so the
 *  boot validator can prove an actionForm's handler recomputes its totals. */
export function formDerivationsOfSchema(
  schema: unknown,
): Readonly<Record<string, FormFieldDerivation>> | undefined {
  return schema instanceof z.ZodType ? derivationsBySchema.get(schema) : undefined;
}

/** Server counterpart of an actionForm's `derive`: recomputes the derived head
 *  fields before the schema validates them, so client-sent totals never count. */
export function withFormDerivations<Schema extends z.ZodType>(
  schema: Schema,
  screen: FormDerivationScreen,
) {
  const wrapped = z.preprocess((value) => applyFormDerivations(value, screen), schema);
  if (screen.derive !== undefined) derivationsBySchema.set(wrapped, screen.derive);
  return wrapped;
}
