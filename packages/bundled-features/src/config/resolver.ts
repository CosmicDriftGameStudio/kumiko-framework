import {
  type DbConnection,
  type EncryptionProvider,
  fetchOne,
  type TenantDb,
} from "@kumiko/framework/db";
import type {
  ConfigKeyDefinition,
  ConfigResolver,
  ConfigValueSource,
  ConfigValueWithSource,
} from "@kumiko/framework/engine";
import { assertUnreachable, parseJsonOrThrow } from "@kumiko/framework/utils";
import { and, eq, isNull, or } from "drizzle-orm";
import { configValuesTable } from "./table";

type ConfigRow = {
  id: number;
  key: string;
  value: string | null;
  tenantId: string | null;
  userId: string | null;
};

// Re-export so existing call sites that imported ConfigResolver from
// "../resolver" keep compiling — the shape now lives in the framework.
export type { ConfigResolver };

function serializeValue(value: string | number | boolean): string {
  return JSON.stringify(value);
}

export function deserializeValue(
  raw: string | null,
  type: ConfigKeyDefinition["type"],
): string | number | boolean | undefined {
  if (raw === null || raw === undefined) return undefined;
  const parsed = parseJsonOrThrow<unknown>(raw, `config value (type=${type})`);
  switch (type) {
    case "number":
      return typeof parsed === "number" ? parsed : Number(parsed);
    case "boolean":
      return typeof parsed === "boolean" ? parsed : parsed === "true";
    case "text":
    case "select":
      return String(parsed);
    default:
      assertUnreachable(type, "config key type");
  }
}

// App-Boot overrides: deploy-time defaults that sit between the
// tenant/system rows and the feature-declared `default`. Use-case: the
// framework ships a default of 10 MB for maxUploadSizeMB, but this
// particular deploy is a photo-app that wants 200 MB — no DB-seed needed,
// just a single Map at boot.
//
// Keys are the fully-qualified names (e.g. "files:config:max-upload-size-mb").
// Values are the raw primitive — serialization happens as part of the
// cascade so the boot-code doesn't need to know about JSON encoding.
//
// Validation at construction time (buildServer-path): unknown keys,
// type-mismatches, and bounds violations throw synchronously. See
// validateAppOverrides below.
export type AppConfigOverrides = ReadonlyMap<string, string | number | boolean>;

export type ConfigResolverOptions = {
  encryption?: EncryptionProvider;
  appOverrides?: AppConfigOverrides;
};

export function createConfigResolver(options: ConfigResolverOptions = {}): ConfigResolver {
  const { encryption, appOverrides } = options;
  async function findRow(
    key: string,
    tenantId: string | null,
    userId: string | null,
    db: DbConnection | TenantDb,
  ): Promise<ConfigRow | null> {
    // Three fixed conditions — the branches pick eq/isNull for the two
    // scope columns. fetchOne's variadic signature combines them with AND.
    const tenantCond =
      tenantId !== null
        ? eq(configValuesTable.tenantId, tenantId)
        : isNull(configValuesTable.tenantId);
    const userCond =
      userId !== null ? eq(configValuesTable.userId, userId) : isNull(configValuesTable.userId);

    const row = await fetchOne<ConfigRow>(
      db,
      configValuesTable,
      eq(configValuesTable.key, key),
      tenantCond,
      userCond,
    );

    return row ?? null;
  }

  return {
    async get(qualifiedKey, keyDef, tenantId, userId, db) {
      // get() is a thin wrapper around getWithSource that discards the
      // source tag. Keeps the hot-path a single implementation.
      const result = await this.getWithSource(qualifiedKey, keyDef, tenantId, userId, db);
      return result.value;
    },

    async getWithSource(
      qualifiedKey,
      keyDef,
      tenantId,
      userId,
      db,
    ): Promise<ConfigValueWithSource> {
      // Resolution cascade based on scope
      // user:   userId+tenantId → tenantId → default
      // tenant: tenantId → system (null) → default
      // system: system (null) → default
      const lookups: Array<{
        tenantId: string | null;
        userId: string | null;
        source: ConfigValueSource;
      }> = [];

      switch (keyDef.scope) {
        case "user":
          lookups.push({ tenantId, userId, source: "user-row" });
          lookups.push({ tenantId, userId: null, source: "tenant-row" });
          break;
        case "tenant":
          lookups.push({ tenantId, userId: null, source: "tenant-row" });
          lookups.push({ tenantId: null, userId: null, source: "system-row" });
          break;
        case "system":
          lookups.push({ tenantId: null, userId: null, source: "system-row" });
          break;
        default:
          assertUnreachable(keyDef.scope, "config scope");
      }

      for (const lookup of lookups) {
        const row = await findRow(qualifiedKey, lookup.tenantId, lookup.userId, db);
        if (row?.value !== null && row?.value !== undefined) {
          let raw = row.value;
          if (keyDef.encrypted && encryption) {
            raw = encryption.decrypt(raw);
          }
          return { value: deserializeValue(raw, keyDef.type), source: lookup.source };
        }
      }

      // App-Boot-Override: one step above the feature-declared default.
      // The override only kicks in when no scope-specific row exists —
      // a tenant-admin that deliberately set a value still wins.
      if (appOverrides?.has(qualifiedKey)) {
        return { value: appOverrides.get(qualifiedKey), source: "app-override" };
      }

      // Computed fallback: plan-based values, feature-flag-Resolver etc.
      // Called after rows + app-overrides miss, before the static default.
      if (keyDef.computed) {
        const value = await keyDef.computed({ tenantId, userId, db });
        return { value, source: "computed" };
      }

      if (keyDef.default !== undefined) {
        return { value: keyDef.default, source: "default" };
      }

      return { value: undefined, source: "missing" };
    },

    async set(qualifiedKey, keyDef, value, tenantId, userId, modifiedById, db) {
      let serialized = serializeValue(value);
      if (keyDef.encrypted && encryption) {
        serialized = encryption.encrypt(serialized);
      }
      const existing = await findRow(qualifiedKey, tenantId, userId, db);

      if (existing) {
        await db
          .update(configValuesTable)
          .set({
            value: serialized,
            modifiedAt: Temporal.Now.instant(),
            modifiedById,
          })
          .where(eq(configValuesTable.id, existing.id));
      } else {
        await db.insert(configValuesTable).values({
          key: qualifiedKey,
          value: serialized,
          tenantId,
          userId,
          modifiedById,
        });
      }
    },

    async reset(qualifiedKey, tenantId, userId, db) {
      const existing = await findRow(qualifiedKey, tenantId, userId, db);
      if (existing) {
        await db.delete(configValuesTable).where(eq(configValuesTable.id, existing.id));
      }
    },

    async getAll(tenantId, userId, db) {
      // Only load rows relevant to this user/tenant (system + tenant + user scope)
      const rows = await db
        .select()
        .from(configValuesTable)
        .where(
          or(
            // System-level values
            and(isNull(configValuesTable.tenantId), isNull(configValuesTable.userId)),
            // Tenant-level values
            and(eq(configValuesTable.tenantId, tenantId), isNull(configValuesTable.userId)),
            // User-level values
            and(eq(configValuesTable.tenantId, tenantId), eq(configValuesTable.userId, userId)),
          ),
        );

      const result = new Map<string, ConfigRow>();
      for (const row of rows) {
        const r = row as ConfigRow;
        // Higher specificity wins: user > tenant > system
        const existing = result.get(r.key);
        if (!existing) {
          result.set(r.key, r);
        } else {
          const existingSpecificity =
            (existing.userId !== null ? 2 : 0) + (existing.tenantId !== null ? 1 : 0);
          const newSpecificity = (r.userId !== null ? 2 : 0) + (r.tenantId !== null ? 1 : 0);
          if (newSpecificity > existingSpecificity) {
            result.set(r.key, r);
          }
        }
      }

      return result;
    },
  };
}

// Validates an app-override Map against a registry before the resolver
// ingests it. Call this from buildServer (or the app's boot wiring) with
// the registry's config keys + the overrides the app-dev provided.
//
// Four classes of errors, all thrown eagerly so a typo in boot-code fails
// immediately instead of silently returning stale defaults in production:
//   1. unknown key → feature probably renamed or not required
//   2. type mismatch → wrong primitive (number for a text key, etc.)
//   3. bounds / options violation → same rule as tenant-admin Set
//   4. computed conflict → app-override would silently beat plan-based
//      logic; incompatible paradigm, requires explicit resolution
//
// The return is a narrowed Map ready to hand to createConfigResolver.
export function validateAppOverrides(
  registry: {
    getConfigKey: (
      key: string,
    ) => import("@kumiko/framework/engine").ConfigKeyDefinition | undefined;
  },
  overrides: Readonly<Record<string, string | number | boolean>>,
): AppConfigOverrides {
  const validated = new Map<string, string | number | boolean>();

  for (const [key, value] of Object.entries(overrides)) {
    const keyDef = registry.getConfigKey(key);
    if (!keyDef) {
      throw new Error(
        `App-Boot-Override for unknown config key "${key}" — no feature declares it. Typo or missing feature-require?`,
      );
    }

    // computed keys encode plan-based business logic ("zahlender Tenant
    // bekommt 100 MB"). An app-override would silently beat that — the
    // cascade puts overrides above computed, so the plan becomes invisible.
    // Force an explicit decision: either drop the override and trust the
    // computed function, or drop computed if the deploy really wants a
    // static default for everyone. Mixing silently is a footgun.
    if (keyDef.computed) {
      throw new Error(
        `App-Boot-Override for "${key}": this key has a computed resolver (plan-based / derived). App-overrides would silently bypass that logic — remove the override, or remove the computed resolver if a flat deploy-default is intended.`,
      );
    }

    const expectedType = typeForKey(keyDef.type);
    if (typeof value !== expectedType) {
      throw new Error(
        `App-Boot-Override for "${key}": expected ${expectedType}, got ${typeof value}`,
      );
    }

    if (keyDef.type === "select" && keyDef.options && !keyDef.options.includes(value as string)) {
      throw new Error(
        `App-Boot-Override for "${key}": value "${String(value)}" is not in options [${keyDef.options.join(", ")}]`,
      );
    }

    if (keyDef.type === "number" && keyDef.bounds) {
      const n = value as number;
      const { min, max } = keyDef.bounds;
      if (min !== undefined && n < min) {
        throw new Error(`App-Boot-Override for "${key}": value ${n} is below bounds.min (${min})`);
      }
      if (max !== undefined && n > max) {
        throw new Error(`App-Boot-Override for "${key}": value ${n} is above bounds.max (${max})`);
      }
    }

    validated.set(key, value);
  }

  return validated;
}

function typeForKey(type: "text" | "number" | "boolean" | "select"): string {
  return type === "number" ? "number" : type === "boolean" ? "boolean" : "string";
}
