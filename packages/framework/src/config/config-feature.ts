import { z } from "zod";
import type { DbConnection } from "../db/connection";
import { defineFeature } from "../engine/define-feature";
import type {
  ConfigKeyDefinition,
  ConfigScope,
  FeatureDefinition,
  Registry,
} from "../engine/types";
import { type ConfigResolver, deserializeValue } from "./resolver";

export type ConfigContext = {
  config: (qualifiedKey: string) => Promise<string | number | boolean | undefined>;
};

export function createConfigFeature(): FeatureDefinition {
  return defineFeature("config", (r) => {
    // config.set — set a config value
    r.writeHandler(
      "config.set",
      z.object({
        key: z.string(),
        value: z.union([z.string(), z.number(), z.boolean()]),
        scope: z.enum(["system", "tenant", "user"]).optional(),
      }),
      async (event, ctx) => {
        const db = ctx["db"] as DbConnection;
        const registry = ctx["registry"] as Registry;
        const resolver = ctx["configResolver"] as ConfigResolver;

        const keyDef = registry.getConfigKey(event.payload.key);
        if (!keyDef) {
          return { isSuccess: false, error: `unknown_config_key: ${event.payload.key}` };
        }

        // Determine scope: explicit or from key definition
        const scope = event.payload.scope ?? keyDef.scope;

        // Access check
        const writeError = checkWriteAccess(keyDef, event.user.roles);
        if (writeError) return { isSuccess: false, error: writeError };

        // Validate scope matches key definition
        const scopeError = validateScope(scope, keyDef.scope, event.payload.key);
        if (scopeError) return { isSuccess: false, error: scopeError };

        // Determine tenantId/userId based on scope
        const { tenantId, userId } = resolveScopeIds(scope, event.user.tenantId, event.user.id);

        // Type validation
        const typeError = validateType(event.payload.value, keyDef);
        if (typeError) return { isSuccess: false, error: typeError };

        await resolver.set(
          event.payload.key,
          keyDef,
          event.payload.value,
          tenantId,
          userId,
          event.user.id,
          db,
        );

        return {
          isSuccess: true,
          data: { key: event.payload.key, value: event.payload.value, scope },
        };
      },
    );

    // config.reset — reset to default
    r.writeHandler(
      "config.reset",
      z.object({
        key: z.string(),
        scope: z.enum(["system", "tenant", "user"]).optional(),
      }),
      async (event, ctx) => {
        const db = ctx["db"] as DbConnection;
        const registry = ctx["registry"] as Registry;
        const resolver = ctx["configResolver"] as ConfigResolver;

        const keyDef = registry.getConfigKey(event.payload.key);
        if (!keyDef) {
          return { isSuccess: false, error: `unknown_config_key: ${event.payload.key}` };
        }

        const scope = event.payload.scope ?? keyDef.scope;

        // Access check
        const writeError = checkWriteAccess(keyDef, event.user.roles);
        if (writeError) return { isSuccess: false, error: writeError };

        const { tenantId, userId } = resolveScopeIds(scope, event.user.tenantId, event.user.id);
        await resolver.reset(event.payload.key, tenantId, userId, db);

        return { isSuccess: true, data: { key: event.payload.key, scope } };
      },
    );

    // config.values — read all config values for current user/tenant
    r.queryHandler("config.values", z.object({}), async (query, ctx) => {
      const db = ctx["db"] as DbConnection;
      const registry = ctx["registry"] as Registry;
      const resolver = ctx["configResolver"] as ConfigResolver;

      const allKeys = registry.getAllConfigKeys();
      // Single query for all stored values (scoped to this user/tenant)
      const storedValues = await resolver.getAll(query.user.tenantId, query.user.id, db);

      const result: Record<
        string,
        { value: string | number | boolean | undefined; scope: ConfigScope }
      > = {};

      for (const [qualifiedKey, keyDef] of allKeys) {
        // Read access check
        if (!hasConfigAccess(keyDef.access.read, query.user.roles)) continue;

        const stored = storedValues.get(qualifiedKey);
        let value: string | number | boolean | undefined;
        if (keyDef.encrypted) {
          // Encrypted keys are always masked in API responses
          value = stored ? "••••••" : undefined;
        } else if (stored?.value !== null && stored?.value !== undefined) {
          value = deserializeValue(stored.value, keyDef.type);
        } else {
          value = keyDef.default;
        }

        result[qualifiedKey] = { value, scope: keyDef.scope };
      }

      return result;
    });

    // config.schema — return all config key definitions (filtered by read access)
    r.queryHandler("config.schema", z.object({}), async (query, ctx) => {
      const registry = ctx["registry"] as Registry;
      const allKeys = registry.getAllConfigKeys();
      const result: Record<string, ConfigKeyDefinition> = {};

      for (const [qualifiedKey, keyDef] of allKeys) {
        if (!hasConfigAccess(keyDef.access.read, query.user.roles)) continue;
        result[qualifiedKey] = keyDef;
      }

      return result;
    });
  });
}

function hasConfigAccess(accessList: readonly string[], userRoles: readonly string[]): boolean {
  if (accessList.includes("all")) return true;
  return userRoles.some((role) => accessList.includes(role));
}

function checkWriteAccess(
  keyDef: ConfigKeyDefinition,
  userRoles: readonly string[],
): string | null {
  if (keyDef.access.write.includes("system")) return "config_key_is_system_only";
  if (!hasConfigAccess(keyDef.access.write, userRoles)) return "access_denied";
  return null;
}

function validateScope(
  requestedScope: ConfigScope,
  definedScope: ConfigScope,
  key: string,
): string | null {
  // Can only write at or above the defined scope level
  const levels: Record<ConfigScope, number> = { system: 0, tenant: 1, user: 2 };
  if (levels[requestedScope] > levels[definedScope]) {
    return `invalid_scope: key "${key}" is scope "${definedScope}", cannot set at "${requestedScope}"`;
  }
  return null;
}

function resolveScopeIds(
  scope: ConfigScope,
  tenantId: number,
  userId: number,
): { tenantId: number | null; userId: number | null } {
  switch (scope) {
    case "system":
      return { tenantId: null, userId: null };
    case "tenant":
      return { tenantId, userId: null };
    case "user":
      return { tenantId, userId };
  }
}

function validateType(
  value: string | number | boolean,
  keyDef: ConfigKeyDefinition,
): string | null {
  switch (keyDef.type) {
    case "number":
      if (typeof value !== "number") return `type_error: expected number, got ${typeof value}`;
      break;
    case "boolean":
      if (typeof value !== "boolean") return `type_error: expected boolean, got ${typeof value}`;
      break;
    case "text":
      if (typeof value !== "string") return `type_error: expected string, got ${typeof value}`;
      break;
    case "select":
      if (typeof value !== "string") return `type_error: expected string, got ${typeof value}`;
      if (keyDef.options && !keyDef.options.includes(value)) {
        return `invalid_option: "${value}" is not in [${keyDef.options.join(", ")}]`;
      }
      break;
  }
  return null;
}

// Helper to create ctx.config() function
export function createConfigAccessor(
  registry: Registry,
  resolver: ConfigResolver,
  tenantId: number,
  userId: number,
  db: DbConnection,
): (qualifiedKey: string) => Promise<string | number | boolean | undefined> {
  return async (qualifiedKey: string) => {
    const keyDef = registry.getConfigKey(qualifiedKey);
    if (!keyDef) return undefined;
    return resolver.get(qualifiedKey, keyDef, tenantId, userId, db);
  };
}
