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
  }

  return {
    registry: createRegistry(config.features),
    roles: config.roles,
  };
}
