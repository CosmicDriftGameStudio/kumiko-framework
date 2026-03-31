import { z } from "zod";
import type { DbConnection } from "../db/connection";
import { createCrudExecutor } from "../db/crud-executor";
import { buildDrizzleTable } from "../db/table-builder";
import { defineFeature } from "../engine/define-feature";
import { createBooleanField, createEntity, createTextField } from "../engine/factories";
import type { FeatureDefinition } from "../engine/types";

const tenantEntity = createEntity({
  table: "tenants",
  fields: {
    key: createTextField({ required: true, maxLength: 50 }),
    name: createTextField({ required: true, maxLength: 200, searchable: true }),
    isEnabled: createBooleanField({ default: true }),
  },
});

const tenantTable = buildDrizzleTable("tenant", tenantEntity);

export function createTenantFeature(): FeatureDefinition {
  return defineFeature("tenant", (r) => {
    r.requires("config");

    r.entity("tenant", tenantEntity);

    // Config keys for tenant settings
    r.config({
      keys: {
        smtpHost: {
          type: "text",
          scope: "tenant",
          access: { write: ["SystemAdmin"], read: ["Admin", "SystemAdmin"] },
        },
        smtpPass: {
          type: "text",
          scope: "tenant",
          encrypted: true,
          access: { write: ["SystemAdmin"], read: ["SystemAdmin"] },
        },
        maxUsers: {
          type: "number",
          default: 50,
          scope: "system",
          access: { write: ["system"], read: ["Admin", "SystemAdmin"] },
        },
      },
    });

    const crud = createCrudExecutor(tenantTable, tenantEntity, { entityName: "tenant" });

    // tenant.create — only SystemAdmin
    r.writeHandler(
      "tenant.create",
      z.object({
        key: z.string().min(1).max(50),
        name: z.string().min(1).max(200),
      }),
      async (event, ctx) => {
        const db = ctx["db"] as DbConnection;
        return crud.create(event.payload, event.user, db);
      },
      { access: { roles: ["SystemAdmin"] } },
    );

    // tenant.update — Admin or SystemAdmin
    r.writeHandler(
      "tenant.update",
      z.object({
        id: z.number(),
        version: z.number().optional(),
        changes: z.object({
          name: z.string().min(1).max(200).optional(),
        }),
      }),
      async (event, ctx) => {
        const db = ctx["db"] as DbConnection;
        return crud.update(event.payload, event.user, db);
      },
      { access: { roles: ["Admin", "SystemAdmin"] } },
    );

    // tenant.disable — only SystemAdmin, sets isEnabled = false
    r.writeHandler(
      "tenant.disable",
      z.object({ id: z.number() }),
      async (event, ctx) => {
        const db = ctx["db"] as DbConnection;
        return crud.update({ id: event.payload.id, changes: { isEnabled: false } }, event.user, db);
      },
      { access: { roles: ["SystemAdmin"] } },
    );

    // tenant.me — returns the current user's tenant
    r.queryHandler("tenant.me", z.object({}), async (query, ctx) => {
      const db = ctx["db"] as DbConnection;
      return crud.detail({ id: query.user.tenantId }, query.user, db);
    });

    // tenant.list — only SystemAdmin, lists all tenants
    r.queryHandler(
      "tenant.list",
      z.object({
        cursor: z.string().optional(),
        limit: z.number().optional(),
        search: z.string().optional(),
      }),
      async (query, ctx) => {
        const db = ctx["db"] as DbConnection;
        return crud.list(query.payload, query.user, db);
      },
      { access: { roles: ["SystemAdmin"] } },
    );
  });
}

export { tenantEntity, tenantTable };

export const TENANT_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS tenants (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL,
    version INTEGER DEFAULT 1 NOT NULL,
    inserted_at TIMESTAMP DEFAULT NOW() NOT NULL,
    modified_at TIMESTAMP,
    inserted_by_id INTEGER,
    modified_by_id INTEGER,
    key TEXT,
    name TEXT,
    is_enabled BOOLEAN DEFAULT TRUE NOT NULL
  )
`;
