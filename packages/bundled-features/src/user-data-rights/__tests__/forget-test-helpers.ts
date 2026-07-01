// Shared seeders for the forget-cleanup integration tests
// (file-binary-forget-cleanup + file-binary-forget-failure). Both drive
// runForgetCleanup against the same fileRef + membership shape — keeping the
// DDL and seed logic in one place so a file_refs/user-schema change updates
// both at once instead of drifting.

import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import type { FileStorageProvider } from "@cosmicdrift/kumiko-framework/files";
import { seedRow } from "@cosmicdrift/kumiko-framework/testing";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { USER_STATUS, userTable } from "../../user";

export const TENANT_SYSTEM = "00000000-0000-4000-8000-000000000001";

// Test file-provider plugin: registers `provider` under the file-foundation
// `fileProvider` extension point so the forget pipeline resolves THIS instance
// through createFileProviderForTenant — the same path production uses. Set
// `file-foundation:config:provider` to `name` to select it.
export function createTestFileProviderFeature(
  provider: FileStorageProvider,
  name = "test",
): FeatureDefinition {
  return defineFeature(`test-file-provider-${name}`, (r) => {
    r.requires("file-foundation");
    r.useExtension("fileProvider", name, { build: async () => provider });
  });
}

type Instant = InstanceType<ReturnType<typeof getTemporal>["Instant"]>;
export const nowInstant = (): Instant => getTemporal().Now.instant();
export const pastInstant = (): Instant =>
  getTemporal().Instant.fromEpochMilliseconds(Date.now() - 60_000);

export const READ_TENANT_MEMBERSHIPS_DDL = `
  CREATE TABLE IF NOT EXISTS read_tenant_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    user_id TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 0,
    inserted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    modified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    inserted_by_id TEXT,
    modified_by_id TEXT,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    deleted_at TIMESTAMPTZ,
    deleted_by_id TEXT,
    roles TEXT NOT NULL DEFAULT '[]',
    UNIQUE(user_id, tenant_id)
  )
`;

interface FileWriter {
  write(key: string, bytes: Uint8Array, mimeType: string): Promise<void>;
}

export interface ForgetSeeders {
  seedForgetUser(id: string): Promise<void>;
  seedMembership(userId: string, tenantId: string): Promise<void>;
  seedFile(id: string, tenantId: string, insertedById: string): Promise<string>;
}

// `writer` is taken separately from the feature's storageProvider so the
// failure test can seed binaries through the real backing store while the
// feature runs against a delete-failing wrapper.
export function createForgetSeeders(db: DbConnection, writer: FileWriter): ForgetSeeders {
  return {
    async seedForgetUser(id) {
      await seedRow(db, userTable, {
        id,
        tenantId: TENANT_SYSTEM,
        email: `user-${id}@example.com`,
        passwordHash: "hashed",
        displayName: `User ${id}`,
        locale: "de",
        emailVerified: true,
        roles: '["Member"]',
        status: USER_STATUS.DeletionRequested,
        gracePeriodEnd: pastInstant(),
      });
    },

    async seedMembership(userId, tenantId) {
      await asRawClient(db).unsafe(
        `INSERT INTO read_tenant_memberships (tenant_id, user_id, roles)
         VALUES ($1, $2, '["Member"]') ON CONFLICT (user_id, tenant_id) DO NOTHING`,
        [tenantId, userId],
      );
    },

    async seedFile(id, tenantId, insertedById) {
      const storageKey = `storage/${id}`;
      await writer.write(storageKey, new Uint8Array([1, 2, 3, 4]), "application/pdf");
      await asRawClient(db).unsafe(
        `INSERT INTO file_refs (id, tenant_id, storage_key, file_name, mime_type, size, inserted_by_id)
         VALUES ($1, $2, $3, $4, 'application/pdf', 4, $5) ON CONFLICT (id) DO NOTHING`,
        [id, tenantId, storageKey, `${id}.pdf`, insertedById],
      );
      return storageKey;
    },
  };
}
