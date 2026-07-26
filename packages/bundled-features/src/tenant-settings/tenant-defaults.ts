// Wrapper um defineEntityCreateHandler: füllt Currency/Locale-Felder aus
// der Tenant-Config (tenant-settings), wenn der Caller sie weglässt —
// statt sie als Feld-Literal ("EUR"/"de") in jeder Entity zu wiederholen.
//
// buildInsertSchema macht `currency` innerhalb eines money-Felds IMMER
// required (auch wenn das Feld selbst optional ist) — der Caller kann die
// Currency also nicht einfach weglassen, ohne dass die Standard-Schema-
// Validierung vor dem Handler-Code abbricht. Deshalb: eigene Schema-
// Extension, die genau diese Sub-Keys optional macht, statt den generischen
// defineEntityCreateHandler zu nutzen.

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
    /** Money-Feldnamen, deren `currency` bei Fehlen aus tenant-settings kommt. */
    readonly currencyFields?: readonly string[];
    /** Feldname (select/text), das bei Fehlen die Tenant-Locale bekommt. */
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
