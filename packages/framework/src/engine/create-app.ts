import type { ScreenDefinition } from "@cosmicdrift/kumiko-types/screen";
import { type ValidateBootOptions, validateBoot } from "./boot-validator";
import { dedupeFeatures } from "./dedupe-features";
import { createRegistry } from "./registry";
import type { FeatureDefinition, Registry } from "./types";
import { DEFAULT_CURRENCIES } from "./types";

export type AppConfig = {
  roles: readonly string[];
  features: readonly FeatureDefinition[];
  softDelete?: boolean; // Global default for all entities (default: true)
  currencies?: readonly string[]; // Extends DEFAULT_CURRENCIES
  /** Opt-in boot-validator warnings — see ValidateBootOptions. */
  validateBootOptions?: ValidateBootOptions;
};

export type App = {
  registry: Registry;
  roles: readonly string[];
  softDeleteDefault: boolean;
  currencies: readonly string[];
};

// Every field map an entity-less inline form screen renders: actionForm's and
// secretMint's own fields, plus a secretMint's separate `confirm` step.
function inlineFormFieldMaps(
  screen: ScreenDefinition,
): readonly Readonly<Record<string, unknown>>[] {
  if (screen.type === "actionForm") return [screen.fields];
  if (screen.type !== "secretMint") return [];
  return screen.confirm !== undefined ? [screen.fields, screen.confirm.fields] : [screen.fields];
}

// `currency: { kind: "literal", code }` (fw#2839) is only meaningful for a
// code the app knows — a typo would otherwise render and submit amounts in a
// currency no formatter or rate table covers.
function validateLiteralCurrencyCode(
  where: string,
  field: unknown,
  currencies: readonly string[],
): void {
  // @cast-boundary schema-walk — feature-config inspection (Author may circumvent type-check)
  const shape = field as { type?: unknown; currency?: { kind?: unknown; code?: unknown } };
  if (shape.type === "money" && shape.currency?.kind === "literal") {
    const code = shape.currency.code;
    if (typeof code !== "string" || !currencies.includes(code)) {
      throw new Error(
        `${where} declares currency: { kind: "literal", code: ${JSON.stringify(code)} } which is ` +
          `not in the currencies list. Available: ${currencies.join(", ")}`,
      );
    }
  }
}

export function createApp(config: AppConfig): App {
  const features = dedupeFeatures(config.features);
  const validRoles = new Set(config.roles);

  // "system" is reserved for SYSTEM_USER — cannot be used as an app role
  if (validRoles.has("system")) {
    throw new Error('Role "system" is reserved for SYSTEM_USER and cannot be used as an app role');
  }

  // Special roles that don't need to be in the app's role list
  const systemRoles = new Set(["all", "system"]);

  // Validate all roles referenced by features exist in app-defined roles.
  // openToAll access has no role list — nothing to validate there.
  for (const feature of features) {
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
    for (const handler of Object.values(feature.streamHandlers)) {
      if (handler.access && "roles" in handler.access) {
        for (const role of handler.access.roles) {
          if (!validRoles.has(role)) {
            throw new Error(
              `Unknown role "${role}" in stream handler "${handler.name}" of feature "${feature.name}". Valid roles: ${config.roles.join(", ")}`,
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
  for (const feature of features) {
    for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
      // A top-level money field isn't the only way an entity can hold money —
      // an embedded-list's sub-schema (e.g. invoice lines) can carry a money
      // cell with no top-level money field at all. Without this, that entity
      // slips past the defaultCurrency check and its cells/totals render in
      // the entity.defaultCurrency ?? "EUR" fallback regardless of the app's
      // actual currency.
      const hasMoneyField = Object.values(entity.fields).some(
        (f) =>
          f.type === "money" ||
          (f.type === "embedded" && Object.values(f.schema).some((s) => s.type === "money")),
      );
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
      for (const [fieldName, field] of Object.entries(entity.fields)) {
        validateLiteralCurrencyCode(
          `Entity "${entityName}" in feature "${feature.name}", money field "${fieldName}"`,
          field,
          currencies,
        );
      }
    }
    // A money field on an entity-less form screen names its own currency
    // source (fw#2839) — a literal code has to be one the app actually knows,
    // same rule the entity `defaultCurrency` check above applies.
    for (const [screenId, screen] of Object.entries(feature.screens ?? {})) {
      const inlineFields = inlineFormFieldMaps(screen);
      for (const fields of inlineFields) {
        for (const [fieldName, field] of Object.entries(fields)) {
          validateLiteralCurrencyCode(
            `Screen "${screenId}" in feature "${feature.name}", money field "${fieldName}"`,
            field,
            currencies,
          );
        }
      }
    }
  }

  // Run boot-time validation before creating registry
  validateBoot(features, config.validateBootOptions);

  return {
    registry: createRegistry(features),
    roles: config.roles,
    softDeleteDefault,
    currencies,
  };
}
