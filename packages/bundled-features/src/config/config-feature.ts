import type { DbConnection, TenantDb } from "@kumiko/framework/db";
import {
  type ConfigAccessor,
  type ConfigAccessorFactory,
  type ConfigKeyHandle,
  type ConfigKeyType,
  type ConfigValue,
  defineFeature,
  type FeatureDefinition,
  type HandlerContext,
  type Registry,
  type TenantId,
} from "@kumiko/framework/engine";
import { InternalError } from "@kumiko/framework/errors";
import { z } from "zod";
import { resetWrite } from "./handlers/reset.write";
import { schemaQuery } from "./handlers/schema.query";
import { setWrite } from "./handlers/set.write";
import { valuesQuery } from "./handlers/values.query";
import type { ConfigResolver } from "./resolver";

export type ConfigContext = { readonly config: ConfigAccessor };

// String constant (not EventDef) so set/reset handlers can append the event
// without importing back into the feature factory — that loop crashes boot.
// Encrypted values are stripped from the payload before append; see the
// `keyDef.encrypted` guard in set.write.ts / reset.write.ts.
export const CONFIG_CHANGED_EVENT_NAME = "config:event:config-changed";

export const configChangedSchema = z.object({
  key: z.string(),
  scope: z.enum(["system", "tenant", "user"]),
  action: z.enum(["set", "reset"]),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

export function createConfigFeature(): FeatureDefinition {
  return defineFeature("config", (r) => {
    r.systemScope();

    r.defineEvent("config-changed", configChangedSchema);

    const handlers = {
      set: r.writeHandler(setWrite),
      reset: r.writeHandler(resetWrite),
    };

    const queries = {
      values: r.queryHandler(valuesQuery),
      schema: r.queryHandler(schemaQuery),
    };

    return { handlers, queries };
  });
}

export function createConfigAccessor(
  registry: Registry,
  resolver: ConfigResolver,
  tenantId: TenantId,
  userId: string,
  db: DbConnection | TenantDb,
): ConfigAccessor {
  async function configAccessor(
    qualifiedKey: string,
  ): Promise<string | number | boolean | undefined>;
  async function configAccessor<T extends ConfigKeyType>(
    handle: ConfigKeyHandle<T>,
  ): Promise<ConfigValue<T> | undefined>;
  async function configAccessor(
    keyOrHandle: string | ConfigKeyHandle<ConfigKeyType>,
  ): Promise<string | number | boolean | undefined> {
    const qualifiedKey = typeof keyOrHandle === "string" ? keyOrHandle : keyOrHandle.name;
    const keyDef = registry.getConfigKey(qualifiedKey);
    if (!keyDef) return undefined;
    return resolver.get(qualifiedKey, keyDef, tenantId, userId, db);
  }
  return configAccessor;
}

// Pass to the test-stack / server-boot as `_configAccessorFactory` —
// `buildHandlerContext` mints a per-user `ctx.config` from this.
export function createConfigAccessorFactory(
  registry: Registry,
  resolver: ConfigResolver,
): ConfigAccessorFactory {
  return ({ user, db }) => createConfigAccessor(registry, resolver, user.tenantId, user.id, db);
}

// Single point of truth for "this handler needs the resolver". Throws a
// proper InternalError (with i18n) instead of bare Error, and points the
// caller at the boot wiring step that's missing — so a future debug
// session reads "config feature not wired into AppContext" instead of a
// generic "configResolver missing".
export function requireConfigResolver(ctx: HandlerContext, handlerName: string): ConfigResolver {
  if (!ctx.configResolver) {
    throw new InternalError({
      message:
        `[${handlerName}] ctx.configResolver missing — pass createConfigAccessorFactory's ` +
        `output via extraContext._configAccessorFactory and the resolver via ` +
        `extraContext.configResolver at boot.`,
    });
  }
  return ctx.configResolver;
}
