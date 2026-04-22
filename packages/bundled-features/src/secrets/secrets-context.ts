// Feature-level accessor injected as `ctx.secrets` at boot. Not a HTTP API —
// feature code that needs a plaintext secret (SMTP-connect, Stripe-call, …)
// pulls it via ctx.secrets.get. Cleartext never crosses the wire.

import type { DbConnection, DbRunner } from "@kumiko/framework/db";
import {
  createDekCache,
  createSecret,
  type DekCache,
  decryptValue,
  encryptValue,
  type MasterKeyProvider,
  type SecretsContext,
} from "@kumiko/framework/secrets";
import { and, eq, sql } from "drizzle-orm";
import {
  type StoredEnvelope,
  type StoredMetadata,
  tenantSecretsAuditTable,
  tenantSecretsTable,
} from "./table";

// Re-export the framework interface so consumers of bundled-features/secrets
// don't need to reach into @kumiko/framework/secrets separately.
export type { Secret, SecretsContext } from "@kumiko/framework/secrets";

export type SecretsContextOptions = {
  readonly db: DbConnection;
  readonly masterKeyProvider: MasterKeyProvider;
  // Shared DEK cache. Default: a fresh 5-min TTL cache. Pass in a shared
  // instance if several features decrypt overlapping secret sets — lowers
  // provider-call count across the app.
  readonly dekCache?: DekCache;
};

// Normalises SecretKeyRef into the storage string. Handles from r.secret
// carry a `.name`; callers that still pass a raw qualified-name string also
// work. The DB stores the qualified name verbatim.
function resolveKey(keyOrHandle: string | { readonly name: string }): string {
  return typeof keyOrHandle === "string" ? keyOrHandle : keyOrHandle.name;
}

// Wrap a provider so its unwrapDek goes through the cache. Lets decryptValue
// use the full provider contract without knowing about caching — separation
// of concerns: decryptValue handles crypto, cache handles cost.
function cachedProvider(provider: MasterKeyProvider, cache: DekCache): MasterKeyProvider {
  return {
    wrapDek: provider.wrapDek.bind(provider),
    unwrapDek: (encryptedDek, version) => cache.unwrapDek(encryptedDek, version, provider),
    currentVersion: provider.currentVersion.bind(provider),
    isAvailable: provider.isAvailable.bind(provider),
  };
}

function decodeEnvelope(stored: StoredEnvelope): {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  encryptedDek: Buffer;
  kekVersion: number;
} {
  return {
    ciphertext: Buffer.from(stored.ciphertext, "base64"),
    iv: Buffer.from(stored.iv, "base64"),
    authTag: Buffer.from(stored.authTag, "base64"),
    encryptedDek: Buffer.from(stored.encryptedDek, "base64"),
    kekVersion: stored.kekVersion,
  };
}

export function createSecretsContext(opts: SecretsContextOptions): SecretsContext {
  const { db, masterKeyProvider } = opts;
  const provider = cachedProvider(masterKeyProvider, opts.dekCache ?? createDekCache());

  return {
    async get(tenantId, keyOrHandle, auditCtx) {
      const key = resolveKey(keyOrHandle);
      // Atomic audit + read: a decrypt that "escaped" the audit trail
      // (because the audit-insert threw) would violate the compliance
      // promise "every read is logged". Wrapping both in a TX means
      // either the caller gets the plaintext AND a row in
      // tenant_secret_reads, or neither — never one without the other.
      // Reads without audit (framework-internal, rotation job) skip the
      // TX entirely since there's nothing to couple.
      const runRead = async (handle: DbRunner): Promise<string | undefined> => {
        const rows = await handle
          .select({ envelope: tenantSecretsTable.envelope })
          .from(tenantSecretsTable)
          .where(and(eq(tenantSecretsTable.tenantId, tenantId), eq(tenantSecretsTable.key, key)))
          .limit(1);
        const row = rows[0];
        if (!row) return undefined;
        return decryptValue(decodeEnvelope(row.envelope), provider);
      };

      if (!auditCtx) {
        const plaintext = await runRead(db);
        if (plaintext === undefined) return undefined;
        return createSecret(plaintext);
      }

      const plaintext = await db.transaction(async (tx) => {
        const result = await runRead(tx);
        if (result === undefined) return undefined;
        await tx.insert(tenantSecretsAuditTable).values({
          tenantId,
          key,
          userId: auditCtx.userId,
          handlerName: auditCtx.handlerName,
        });
        return result;
      });

      if (plaintext === undefined) return undefined;
      // Brand the plaintext only after audit committed. The response
      // serializer rejects any Secret<> it finds on the response path.
      return createSecret(plaintext);
    },

    async set(tenantId, keyOrHandle, value, setOpts = {}) {
      const key = resolveKey(keyOrHandle);
      const envelope = await encryptValue(value, masterKeyProvider);
      const stored: StoredEnvelope = {
        ciphertext: envelope.ciphertext.toString("base64"),
        iv: envelope.iv.toString("base64"),
        authTag: envelope.authTag.toString("base64"),
        encryptedDek: envelope.encryptedDek.toString("base64"),
        kekVersion: envelope.kekVersion,
      };
      const metadata: StoredMetadata = {
        ...(setOpts.redact ? { redactedPreview: setOpts.redact(value) } : {}),
        ...(setOpts.hint ? { hint: setOpts.hint } : {}),
      };

      await db
        .insert(tenantSecretsTable)
        .values({
          tenantId,
          key,
          envelope: stored,
          kekVersion: envelope.kekVersion,
          metadata,
          ...(setOpts.updatedBy ? { updatedById: setOpts.updatedBy } : {}),
        })
        .onConflictDoUpdate({
          target: [tenantSecretsTable.tenantId, tenantSecretsTable.key],
          set: {
            envelope: stored,
            kekVersion: envelope.kekVersion,
            metadata,
            lastRotatedAt: sql`now()`,
            ...(setOpts.updatedBy ? { updatedById: setOpts.updatedBy } : {}),
          },
        });
    },

    async delete(tenantId, keyOrHandle) {
      const key = resolveKey(keyOrHandle);
      const deleted = await db
        .delete(tenantSecretsTable)
        .where(and(eq(tenantSecretsTable.tenantId, tenantId), eq(tenantSecretsTable.key, key)))
        .returning({ id: tenantSecretsTable.id });
      return deleted.length > 0;
    },
  };
}
