import { and, eq, isNull, or } from "drizzle-orm";
import type { DbConnection } from "../db/connection";
import type { EncryptionProvider } from "../db/encryption";
import type { ConfigKeyDefinition } from "../engine/types";
import { configValuesTable } from "./table";

type ConfigRow = {
  id: number;
  key: string;
  value: string | null;
  tenantId: number | null;
  userId: number | null;
};

export type ConfigResolver = {
  get(
    qualifiedKey: string,
    keyDef: ConfigKeyDefinition,
    tenantId: number,
    userId: number,
    db: DbConnection,
  ): Promise<string | number | boolean | undefined>;

  set(
    qualifiedKey: string,
    keyDef: ConfigKeyDefinition,
    value: string | number | boolean,
    tenantId: number | null,
    userId: number | null,
    modifiedById: number,
    db: DbConnection,
  ): Promise<void>;

  reset(
    qualifiedKey: string,
    tenantId: number | null,
    userId: number | null,
    db: DbConnection,
  ): Promise<void>;

  getAll(
    tenantId: number,
    userId: number,
    db: DbConnection,
  ): Promise<ReadonlyMap<string, ConfigRow>>;
};

function serializeValue(value: string | number | boolean): string {
  return JSON.stringify(value);
}

export function deserializeValue(
  raw: string | null,
  type: ConfigKeyDefinition["type"],
): string | number | boolean | undefined {
  if (raw === null || raw === undefined) return undefined;
  const parsed: unknown = JSON.parse(raw);
  switch (type) {
    case "number":
      return typeof parsed === "number" ? parsed : Number(parsed);
    case "boolean":
      return typeof parsed === "boolean" ? parsed : parsed === "true";
    case "text":
    case "select":
      return String(parsed);
  }
}

export type ConfigResolverOptions = {
  encryption?: EncryptionProvider;
};

export function createConfigResolver(options: ConfigResolverOptions = {}): ConfigResolver {
  const { encryption } = options;
  async function findRow(
    key: string,
    tenantId: number | null,
    userId: number | null,
    db: DbConnection,
  ): Promise<ConfigRow | null> {
    const conditions = [eq(configValuesTable.key, key)];

    if (tenantId !== null) {
      conditions.push(eq(configValuesTable.tenantId, tenantId));
    } else {
      conditions.push(isNull(configValuesTable.tenantId));
    }

    if (userId !== null) {
      conditions.push(eq(configValuesTable.userId, userId));
    } else {
      conditions.push(isNull(configValuesTable.userId));
    }

    const [row] = await db
      .select()
      .from(configValuesTable)
      .where(and(...conditions));

    return (row as ConfigRow) ?? null;
  }

  return {
    async get(qualifiedKey, keyDef, tenantId, userId, db) {
      // Resolution cascade based on scope
      // user:   userId+tenantId → tenantId → default
      // tenant: tenantId → system (null) → default
      // system: system (null) → default
      const lookups: Array<{ tenantId: number | null; userId: number | null }> = [];

      switch (keyDef.scope) {
        case "user":
          lookups.push({ tenantId, userId });
          lookups.push({ tenantId, userId: null });
          break;
        case "tenant":
          lookups.push({ tenantId, userId: null });
          lookups.push({ tenantId: null, userId: null });
          break;
        case "system":
          lookups.push({ tenantId: null, userId: null });
          break;
      }

      for (const lookup of lookups) {
        const row = await findRow(qualifiedKey, lookup.tenantId, lookup.userId, db);
        if (row?.value !== null && row?.value !== undefined) {
          let raw = row.value;
          if (keyDef.encrypted && encryption) {
            raw = encryption.decrypt(raw);
          }
          return deserializeValue(raw, keyDef.type);
        }
      }

      return keyDef.default;
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
            modifiedAt: new Date(),
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
