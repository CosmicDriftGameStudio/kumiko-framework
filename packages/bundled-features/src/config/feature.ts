import type { DbConnection, EncryptionProvider, TenantDb } from "@cosmicdrift/kumiko-framework/db";
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
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { cascadeQuery } from "./handlers/cascade.query";
import { resetWrite } from "./handlers/reset.write";
import { schemaQuery } from "./handlers/schema.query";
import { setWrite } from "./handlers/set.write";
import { valuesQuery } from "./handlers/values.query";
import type { ConfigResolver } from "./resolver";
import { configValueEntity } from "./table";

export type ConfigContext = { readonly config: ConfigAccessor };

export function createConfigFeature(): FeatureDefinition {
  return defineFeature("config", (r) => {
    r.systemScope();

    // One aggregate stream per (key, scope) pair — the executor handles the
    // lifecycle events `configValue.created / .updated / .deleted` plus the
    // projection write in one TX. Subscribers that need config-change
    // semantics listen to those auto-events via r.multiStreamProjection
    // (see docs/plans/architecture/event-sourcing-pivot.md §4.7).
    r.entity("config-value", configValueEntity);

    const handlers = {
      set: r.writeHandler(setWrite),
      reset: r.writeHandler(resetWrite),
    };

    const queries = {
      cascade: r.queryHandler(cascadeQuery),
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

// Mirror of requireConfigResolver for the encryption round-trip side.
// Only keys declared `encrypted: true` need this — the setter calls it
// lazily so apps that never wire encryption still boot (and only crash
// if a handler tries to write an encrypted key without the provider in
// place, pointing at the exact wiring gap).
export function requireConfigEncryption(
  ctx: HandlerContext,
  handlerName: string,
): EncryptionProvider {
  if (!ctx.configEncryption) {
    throw new InternalError({
      message:
        `[${handlerName}] ctx.configEncryption missing — at least one config key declares ` +
        `encrypted: true, so the boot wiring must pass an EncryptionProvider via ` +
        `extraContext.configEncryption (same instance the resolver was built with).`,
    });
  }
  return ctx.configEncryption;
}
