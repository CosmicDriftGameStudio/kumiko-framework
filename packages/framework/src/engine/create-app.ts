import { createRegistry } from "./registry";
import type { FeatureDefinition, Registry } from "./types";

export type AppConfig = {
  roles: readonly string[];
  features: readonly FeatureDefinition[];
};

export type App = {
  registry: Registry;
  roles: readonly string[];
};

export function createApp(config: AppConfig): App {
  const validRoles = new Set(config.roles);

  // Special roles that don't need to be in the app's role list
  const systemRoles = new Set(["all", "system"]);

  // Validate all roles referenced by features exist in app-defined roles
  for (const feature of config.features) {
    for (const handler of Object.values(feature.writeHandlers)) {
      if (handler.access) {
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
      if (handler.access) {
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

  return {
    registry: createRegistry(config.features),
    roles: config.roles,
  };
}
