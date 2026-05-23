import {
  type DbConnection,
  type EncryptionProvider,
  type TenantDb,
} from "@cosmicdrift/kumiko-framework/db";
import type {
  ConfigCascade,
  ConfigCascadeLevel,
  ConfigKeyDefinition,
  ConfigResolver,
  ConfigStoredRowWithSource,
  ConfigValueSource,
  ConfigValueWithSource,
} from "@cosmicdrift/kumiko-framework/engine";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { assertUnreachable, parseJsonOrThrow } from "@cosmicdrift/kumiko-framework/utils";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { configValuesTable } from "./table";
import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";

type ConfigRow = {
  id: string;
  key: string;
  value: string | null;
  tenantId: string;
  userId: string | null;
};

// Re-export so existing call sites that imported ConfigResolver from
// "../resolver" keep compiling — the shape now lives in the framework.
export type { ConfigResolver };

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

// Shared cascade-builder. Single-key path passes a `findRow`-bound row
// fetcher (one SQL per lookup); batch path passes a closure over
// pre-loaded rows. The builder itself is unaware of which.
async function buildCascade(
  qualifiedKey: string,
  keyDef: ConfigKeyDefinition,
  tenantId: string,
  userId: string,
  db: DbConnection | TenantDb,
  fetchRow: (
    tenantId: string,
    userId: string | null,
  ) => Promise<ConfigRow | null> | ConfigRow | null,
  appOverrides: AppConfigOverrides | undefined,
  encryption: EncryptionProvider | undefined,
): Promise<ConfigCascade> {
  type Lookup = {
    tenantId: string;
    userId: string | null;
    source: ConfigValueSource;
    label: string;
  };
  const lookups: Lookup[] = [];

  switch (keyDef.scope) {
    case "user":
      lookups.push({ tenantId, userId, source: "user-row", label: "User" });
      lookups.push({ tenantId, userId: null, source: "tenant-row", label: "Tenant" });
      break;
    case "tenant":
      lookups.push({ tenantId, userId: null, source: "tenant-row", label: "Tenant" });
      lookups.push({
        tenantId: SYSTEM_TENANT_ID,
        userId: null,
        source: "system-row",
        label: "System",
      });
      break;
    case "system":
      lookups.push({
        tenantId: SYSTEM_TENANT_ID,
        userId: null,
        source: "system-row",
        label: "System",
      });
      break;
    default:
      assertUnreachable(keyDef.scope, "config scope");
  }

  const levels: ConfigCascadeLevel[] = [];
  let activeIndex = -1;

  for (const lookup of lookups) {
    const row = await fetchRow(lookup.tenantId, lookup.userId);
    if (row?.value !== null && row?.value !== undefined) {
      let raw = row.value;
      if (keyDef.encrypted && encryption) {
        raw = encryption.decrypt(raw);
      }
      if (activeIndex === -1) activeIndex = levels.length;
      levels.push({
        label: lookup.label,
        value: deserializeValue(raw, keyDef.type),
        source: lookup.source,
        isActive: false,
        hasValue: true,
      });
    } else {
      levels.push({
        label: lookup.label,
        value: undefined,
        source: lookup.source,
        isActive: false,
        hasValue: false,
      });
    }
  }

  const overrideValue = appOverrides?.get(qualifiedKey);
  const hasOverride = overrideValue !== undefined;
  if (activeIndex === -1 && hasOverride) activeIndex = levels.length;
  levels.push({
    label: "App-Override",
    value: overrideValue,
    source: "app-override",
    isActive: false,
    hasValue: hasOverride,
  });

  if (keyDef.computed) {
    const value = await keyDef.computed({ tenantId, userId, db });
    if (activeIndex === -1) activeIndex = levels.length;
    levels.push({
      label: "Computed",
      value,
      source: "computed",
      isActive: false,
      hasValue: true,
    });
  } else {
    levels.push({
      label: "Computed",
      value: undefined,
      source: "computed",
      isActive: false,
      hasValue: false,
    });
  }

  if (keyDef.default !== undefined) {
    if (activeIndex === -1) activeIndex = levels.length;
    levels.push({
      label: "Default",
      value: keyDef.default,
      source: "default",
      isActive: false,
      hasValue: true,
    });
  } else {
    if (activeIndex === -1) activeIndex = levels.length;
    levels.push({
      label: "Default",
      value: undefined,
      source: "missing",
      isActive: false,
      hasValue: false,
    });
  }

  const active = activeIndex >= 0 ? levels[activeIndex] : undefined;
  if (active !== undefined) {
    levels[activeIndex] = { ...active, isActive: true };
  }

  return {
    value: active?.value,
    source: active?.source ?? "missing",
    levels,
  };
}

export function createConfigResolver(options: ConfigResolverOptions = {}): ConfigResolver {
  const { encryption, appOverrides } = options;
  async function findRow(
    key: string,
    tenantId: string,
    userId: string | null,
    db: DbConnection | TenantDb,
  ): Promise<ConfigRow | null> {
    const row = await fetchOne<ConfigRow>(db, configValuesTable, {
      key,
      tenantId,
      userId,
    });

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
      // tenant: tenantId → SYSTEM_TENANT_ID → default
      // system: SYSTEM_TENANT_ID → default
      const lookups: Array<{
        tenantId: string;
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
          lookups.push({ tenantId: SYSTEM_TENANT_ID, userId: null, source: "system-row" });
          break;
        case "system":
          lookups.push({ tenantId: SYSTEM_TENANT_ID, userId: null, source: "system-row" });
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

    async getAll(tenantId, userId, db) {
      // Only load rows relevant to this user/tenant (system + tenant + user scope)
      const rows = await db
        .select()
        .from(configValuesTable)
        .where(
          or(
            // System-level values
            and(eq(configValuesTable.tenantId, SYSTEM_TENANT_ID), isNull(configValuesTable.userId)),
            // Tenant-level values
            and(eq(configValuesTable.tenantId, tenantId), isNull(configValuesTable.userId)),
            // User-level values
            and(eq(configValuesTable.tenantId, tenantId), eq(configValuesTable.userId, userId)),
          ),
        );

      const result = new Map<string, ConfigRow>();
      for (const row of rows) {
        const r = row as ConfigRow; // @cast-boundary db-row
        // Higher specificity wins: user > tenant > system. Under the ES
        // schema system rows carry SYSTEM_TENANT_ID instead of NULL, so the
        // "tenant set" check compares against the sentinel rather than null.
        const specificityOf = (candidate: ConfigRow) =>
          (candidate.userId !== null ? 2 : 0) + (candidate.tenantId !== SYSTEM_TENANT_ID ? 1 : 0);
        const existing = result.get(r.key);
        if (!existing || specificityOf(r) > specificityOf(existing)) {
          result.set(r.key, r);
        }
      }

      return result;
    },

    async getAllWithSource(tenantId, userId, db) {
      // Load ALL potentially relevant rows (user + tenant + system)
      const rows = await db
        .select()
        .from(configValuesTable)
        .where(
          or(
            and(eq(configValuesTable.tenantId, SYSTEM_TENANT_ID), isNull(configValuesTable.userId)),
            and(eq(configValuesTable.tenantId, tenantId), isNull(configValuesTable.userId)),
            and(eq(configValuesTable.tenantId, tenantId), eq(configValuesTable.userId, userId)),
          ),
        );

      const result = new Map<string, ConfigStoredRowWithSource>();

      // Group rows by key so we can determine the winner and its source
      const groups = new Map<string, ConfigRow[]>();
      for (const row of rows) {
        const r = row as ConfigRow; // @cast-boundary db-row
        const g = groups.get(r.key) ?? [];
        g.push(r);
        groups.set(r.key, g);
      }

      for (const [key, keyRows] of groups) {
        const specificityOf = (candidate: ConfigRow) =>
          (candidate.userId !== null ? 2 : 0) + (candidate.tenantId !== SYSTEM_TENANT_ID ? 1 : 0);

        const first = keyRows[0];
        if (!first) continue;
        let winner: ConfigRow = first;
        for (const r of keyRows) {
          if (specificityOf(r) > specificityOf(winner)) {
            winner = r;
          }
        }

        let source: ConfigValueSource;
        if (winner.userId !== null) {
          source = "user-row";
        } else if (winner.tenantId !== SYSTEM_TENANT_ID) {
          source = "tenant-row";
        } else {
          source = "system-row";
        }

        result.set(key, { ...winner, source });
      }

      return result;
    },

    async getCascade(qualifiedKey, keyDef, tenantId, userId, db): Promise<ConfigCascade> {
      // Single-key path uses findRow per cascade step. The batch path
      // bulk-loads all rows up-front; both build identical levels arrays.
      return buildCascade(
        qualifiedKey,
        keyDef,
        tenantId,
        userId,
        db,
        (tid, uid) => findRow(qualifiedKey, tid, uid, db),
        appOverrides,
        encryption,
      );
    },

    async getCascadeBatch(
      keys,
      keyDefs,
      tenantId,
      userId,
      db,
    ): Promise<ReadonlyMap<string, ConfigCascade>> {
      if (keys.length === 0) return new Map();

      // One SQL query for all keys + every scope (user-row,
      // tenant-row, system-row). The cascade-builder then matches
      // per-key from this preloaded set instead of querying again.
      const rows = await db
        .select()
        .from(configValuesTable)
        .where(
          and(
            inArray(configValuesTable.key, [...keys]),
            or(
              and(
                eq(configValuesTable.tenantId, SYSTEM_TENANT_ID),
                isNull(configValuesTable.userId),
              ),
              and(eq(configValuesTable.tenantId, tenantId), isNull(configValuesTable.userId)),
              and(eq(configValuesTable.tenantId, tenantId), eq(configValuesTable.userId, userId)),
            ),
          ),
        );

      const grouped = new Map<string, ConfigRow[]>();
      for (const row of rows) {
        const r = row as ConfigRow; // @cast-boundary db-row
        const g = grouped.get(r.key) ?? [];
        g.push(r);
        grouped.set(r.key, g);
      }

      const result = new Map<string, ConfigCascade>();
      for (const key of keys) {
        const keyDef = keyDefs.get(key);
        if (!keyDef) continue;

        const keyRows = grouped.get(key) ?? [];
        const cascade = await buildCascade(
          key,
          keyDef,
          tenantId,
          userId,
          db,
          (tid, uid) =>
            keyRows.find((r) => r.tenantId === tid && (r.userId ?? null) === uid) ?? null,
          appOverrides,
          encryption,
        );
        result.set(key, cascade);
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
    ) => import("@cosmicdrift/kumiko-framework/engine").ConfigKeyDefinition | undefined;
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

    // Per keyDef.type narrow value inline — TS narrowt nicht durch
    // `typeof value !== typeForKey(...)` (typeForKey returnt string,
    // kein discriminator). Das vermeidet `value as string|number` casts
    // unten, weil value innerhalb des Branches schon typed ist.
    if (keyDef.type === "number") {
      if (typeof value !== "number") {
        throw new Error(`App-Boot-Override for "${key}": expected number, got ${typeof value}`);
      }
      if (keyDef.bounds) {
        const { min, max } = keyDef.bounds;
        if (min !== undefined && value < min) {
          throw new Error(
            `App-Boot-Override for "${key}": value ${value} is below bounds.min (${min})`,
          );
        }
        if (max !== undefined && value > max) {
          throw new Error(
            `App-Boot-Override for "${key}": value ${value} is above bounds.max (${max})`,
          );
        }
      }
    } else if (keyDef.type === "boolean") {
      if (typeof value !== "boolean") {
        throw new Error(`App-Boot-Override for "${key}": expected boolean, got ${typeof value}`);
      }
    } else {
      // text or select
      if (typeof value !== "string") {
        throw new Error(`App-Boot-Override for "${key}": expected string, got ${typeof value}`);
      }
      if (keyDef.type === "select" && keyDef.options && !keyDef.options.includes(value)) {
        throw new Error(
          `App-Boot-Override for "${key}": value "${value}" is not in options [${keyDef.options.join(", ")}]`,
        );
      }
    }

    validated.set(key, value);
  }

  return validated;
}
