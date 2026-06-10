import { validateBoot } from "./boot-validator";
import { createRegistry } from "./registry";
import type { FeatureDefinition, Registry } from "./types";
import { DEFAULT_CURRENCIES } from "./types";

export type AppConfig = {
  roles: readonly string[];
  features: readonly FeatureDefinition[];
  softDelete?: boolean; // Global default for all entities (default: true)
  currencies?: readonly string[]; // Extends DEFAULT_CURRENCIES
};

export type App = {
  registry: Registry;
  roles: readonly string[];
  softDeleteDefault: boolean;
  currencies: readonly string[];
};

export function createApp(config: AppConfig): App {
  const validRoles = new Set(config.roles);

  // "system" is reserved for SYSTEM_USER — cannot be used as an app role
  if (validRoles.has("system")) {
    throw new Error('Role "system" is reserved for SYSTEM_USER and cannot be used as an app role');
  }

  // Special roles that don't need to be in the app's role list
  const systemRoles = new Set(["all", "system"]);

  // Validate all roles referenced by features exist in app-defined roles.
  // openToAll access has no role list — nothing to validate there.
  for (const feature of config.features) {
    for (const handler of Object.values(feature.writeHandlers)) {
      if (handler.access && "roles" in handler.access) {
        for (const role of handler.access.roles) {
          if (!validRoles.has(role)) {
            throw new Error(
              `Unknown role "${role}" in write handler "${handler.name}" of feature "${feature.name}". Valid roles: ${config.roles.join(", ")}`,
            );
          }
        }
      }
    }
    for (const handler of Object.values(feature.queryHandlers)) {
      if (handler.access && "roles" in handler.access) {
        for (const role of handler.access.roles) {
          if (!validRoles.has(role)) {
            throw new Error(
              `Unknown role "${role}" in query handler "${handler.name}" of feature "${feature.name}". Valid roles: ${config.roles.join(", ")}`,
            );
          }
        }
      }
    }
    for (const [key, keyDef] of Object.entries(feature.configKeys)) {
      for (const role of [...keyDef.access.read, ...keyDef.access.write]) {
        if (!systemRoles.has(role) && !validRoles.has(role)) {
          throw new Error(
            `Unknown role "${role}" in config key "${feature.name}.${key}" of feature "${feature.name}". Valid roles: ${config.roles.join(", ")}`,
          );
        }
      }
    }
  }

  const softDeleteDefault = config.softDelete ?? true;

  // Merge default + custom currencies, deduplicate
  const currencies = [...new Set([...DEFAULT_CURRENCIES, ...(config.currencies ?? [])])];

  // Validate defaultCurrency on entities that have money fields
  for (const feature of config.features) {
    for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
      const hasMoneyField = Object.values(entity.fields).some((f) => f.type === "money");
      if (entity.defaultCurrency && !currencies.includes(entity.defaultCurrency)) {
        throw new Error(
          `Entity "${entityName}" in feature "${feature.name}" has defaultCurrency "${entity.defaultCurrency}" which is not in the currencies list. Available: ${currencies.join(", ")}`,
        );
      }
      if (hasMoneyField && !entity.defaultCurrency) {
        throw new Error(
          `Entity "${entityName}" in feature "${feature.name}" has money fields but no defaultCurrency. Set defaultCurrency on the entity definition.`,
        );
      }
    }
  }

  // Run boot-time validation before creating registry
  validateBoot(config.features);

  return {
    registry: createRegistry(config.features),
    roles: config.roles,
    softDeleteDefault,
    currencies,
  };
}
