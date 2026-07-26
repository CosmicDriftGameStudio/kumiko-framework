// Wrapper around defineEntityCreateHandler: fills currency/locale fields from
// tenant-settings config when the caller omits them — instead of repeating
// field literals ("EUR"/"de") on every entity.
//
// buildInsertSchema always requires `currency` inside a money field (even when
// the field itself is optional), so the caller cannot simply omit currency
// without failing schema validation before the handler runs. This helper uses
// a schema extension that makes those sub-keys optional, instead of the
// generic defineEntityCreateHandler.

import {
  type AccessRule,
  buildInsertSchema,
  createEntityExecutor,
  type EntityDefinition,
  type WriteHandlerDef,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { TenantSettingsConfig } from "./constants";

const OPTIONAL_CURRENCY_MONEY = z.object({ amount: z.number(), currency: z.string().optional() });

export function defineCreateWithTenantDefaults(
  entityName: string,
  entity: EntityDefinition,
  options: {
    readonly access?: AccessRule;
    /** Money field names whose `currency` is filled from tenant-settings when missing. */
    readonly currencyFields?: readonly string[];
    /** Field name (select/text) that receives the tenant locale when missing. */
    readonly localeField?: string;
  },
): WriteHandlerDef {
  const { executor } = createEntityExecutor(entityName, entity);
  const relax: Record<string, z.ZodTypeAny> = {};
  for (const field of options.currencyFields ?? []) {
    const def = entity.fields[field];
    if (!def) throw new Error(`defineCreateWithTenantDefaults: unknown field "${field}"`);
    const isRequired = "required" in def && def.required === true;
    relax[field] = isRequired ? OPTIONAL_CURRENCY_MONEY : OPTIONAL_CURRENCY_MONEY.optional();
  }
  const baseSchema = buildInsertSchema(entity);
  const schema = Object.keys(relax).length > 0 ? baseSchema.extend(relax) : baseSchema;

  return {
    name: `${entityName}:create`,
    schema,
    ...(options.access && { access: options.access }),
    handler: async (event, ctx) => {
      const payload = { ...(event.payload as Record<string, unknown>) };

      for (const field of options.currencyFields ?? []) {
        const value = payload[field] as { amount?: number; currency?: string } | undefined;
        if (value && typeof value === "object" && !value.currency) {
          const currency = await ctx.config?.(TenantSettingsConfig.currency);
          if (typeof currency === "string") payload[field] = { ...value, currency };
        }
      }
      if (options.localeField && !payload[options.localeField]) {
        const locale = await ctx.config?.(TenantSettingsConfig.locale);
        if (typeof locale === "string") payload[options.localeField] = locale;
      }

      return executor.create(payload, event.user, ctx.db);
    },
  };
}
