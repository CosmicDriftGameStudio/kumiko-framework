// Feature-level accessor injected as `ctx.secrets` at boot. Not a HTTP API —
// feature code that needs a plaintext secret (SMTP-connect, Stripe-call, …)
// pulls it via ctx.secrets.get. Cleartext never crosses the wire.
//
// Post-ES pivot: all three ops (get/set/delete) flow through the events-
// table.
//   - set → executor.create / .update on the tenantSecret aggregate
//   - delete → executor.delete
//   - get → low-level append of tenantSecretRead-event on a fresh
//           aggregate-stream (one-event-per-read, so parallel reads never
//           race on the secret's own version). The audit invariant ("every
//           read logged") now sits on the events-table instead of a
//           dedicated audit-table.

import { fetchOne, transaction } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  createEventStoreExecutor,
  createTenantDb,
  type DbConnection,
} from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError, type WriteErrorInfo } from "@cosmicdrift/kumiko-framework/errors";
import { append, type EventMetadata } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createDekCache,
  createSecret,
  decodeStoredEnvelope,
  type DekCache,
  decryptValue,
  encodeStoredEnvelope,
  encryptValue,
  type MasterKeyProvider,
  type SecretsContext,
  withDekCache,
} from "@cosmicdrift/kumiko-framework/secrets";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { z } from "zod";
import { selectTenantSecretEnvelope } from "./db/queries/read";
import {
  type StoredEnvelope,
  type StoredMetadata,
  tenantSecretEntity,
  tenantSecretsTable,
} from "./table";

// Re-export the framework interface so consumers of bundled-features/secrets
// don't need to reach into @cosmicdrift/kumiko-framework/secrets separately.
export type { Secret, SecretsContext } from "@cosmicdrift/kumiko-framework/secrets";

export type SecretsContextOptions = {
  readonly db: DbConnection;
  readonly masterKeyProvider: MasterKeyProvider;
  // Shared DEK cache. Default: a fresh 5-min TTL cache. Pass in a shared
  // instance if several features decrypt overlapping secret sets — lowers
  // provider-call count across the app.
  readonly dekCache?: DekCache;
};

// Synthetic actor identity for set/delete — the executor wants a full
// SessionUser, but the secrets-context API takes only a user-id string
// (via opts.updatedBy / opts.deletedBy). `system`-role mirrors how jobs
// and seeds attribute out-of-band writes: non-admin paths stay blocked,
// framework-internal ops keep working.
const SYSTEM_ROLES = ["system"] as const;

// Secret-read audit-event type name + schema. Colocated here instead of
// in secrets-feature.ts because the feature file imports the context
// (via createSecretsContext), so schema-in-feature-file would cycle.
// secrets-feature.ts re-exports `secretReadSchema` for r.defineEvent.
export const TENANT_SECRET_READ_EVENT = "secrets:event:read";
export const secretReadSchema = z.object({
  key: z.string(),
  userId: z.string(),
  handlerName: z.string(),
});

const executor = createEventStoreExecutor(tenantSecretsTable, tenantSecretEntity, {
  entityName: "tenant-secret",
});

function resolveKey(keyOrHandle: string | { readonly name: string }): string {
  return typeof keyOrHandle === "string" ? keyOrHandle : keyOrHandle.name;
}

export function createSecretsContext(opts: SecretsContextOptions): SecretsContext {
  const { db, masterKeyProvider } = opts;
  const provider = withDekCache(masterKeyProvider, opts.dekCache ?? createDekCache());

  type SecretLookupRow = {
    readonly id: string;
    readonly version: number;
    readonly envelope: StoredEnvelope;
  };

  async function lookup(tenantId: string, key: string): Promise<SecretLookupRow | undefined> {
    return fetchOne<SecretLookupRow>(db, tenantSecretsTable, { tenantId, key });
  }

  return {
    async get(tenantId, keyOrHandle, auditCtx) {
      const key = resolveKey(keyOrHandle);
      // Atomic audit + read: a decrypt that "escaped" the audit trail
      // (because the audit-append threw) would violate the compliance
      // promise "every read is logged". Wrapping both in a TX means
      // either the caller gets the plaintext AND a read-event row, or
      // neither. Reads without audit (framework-internal, rotation job)
      // skip the TX — there's nothing to couple.
      if (!auditCtx) {
        const existing = await lookup(tenantId, key);
        if (!existing) return undefined;
        const plaintext = await decryptValue(decodeStoredEnvelope(existing.envelope), provider);
        return createSecret(plaintext);
      }

      const plaintext = await transaction(db, async (tx) => {
        // Inline select inside the TX via raw client — fetchOne's connection
        // type doesn't widen to the transaction object cleanly.
        const envelope = await selectTenantSecretEnvelope(tx, tenantId, key);
        if (!envelope) return undefined;
        const pt = await decryptValue(decodeStoredEnvelope(envelope), provider);

        // One event per read on its own aggregate-stream (fresh UUID as
        // aggregateId). Avoids version-conflicts between parallel reads —
        // a shared stream on the tenantSecret-aggregate would force
        // serialization and turn read-amplification into lock-amplification.
        // MSP consumers still group by payload.key if they want per-secret
        // read counts.
        const readId = generateId();
        const metadata: EventMetadata = { userId: auditCtx.userId };
        // Parse against the registered schema so the low-level append
        // here gets the same validation guarantee as ctx.appendEvent.
        // A payload-shape drift between schema + call-site fails at the
        // source instead of landing on the events-stream.
        const payload = secretReadSchema.parse({
          key,
          userId: auditCtx.userId,
          handlerName: auditCtx.handlerName,
        });
        await append(tx as unknown as Parameters<typeof append>[0], {
          aggregateId: readId,
          aggregateType: "tenantSecretRead",
          tenantId,
          expectedVersion: 0,
          type: TENANT_SECRET_READ_EVENT,
          payload,
          metadata,
        });
        return pt;
      });

      if (plaintext === undefined) return undefined;
      // Brand the plaintext only after audit committed. The response
      // serializer rejects any Secret<> it finds on the response path.
      return createSecret(plaintext);
    },

    async has(tenantId, keyOrHandle) {
      // Row-existence only — no decrypt, no DEK unwrap, no read-audit
      // event. The audit table logs credential reads; a readiness probe
      // never sees the value, so logging it would dilute the trail.
      const existing = await lookup(tenantId, resolveKey(keyOrHandle));
      return existing !== undefined;
    },

    async set(tenantId, keyOrHandle, value, setOpts = {}) {
      const key = resolveKey(keyOrHandle);
      const envelope = await encryptValue(value, masterKeyProvider);
      const stored: StoredEnvelope = encodeStoredEnvelope(envelope);
      const metadata: StoredMetadata = {
        ...(setOpts.redact ? { redactedPreview: setOpts.redact(value) } : {}),
        ...(setOpts.hint ? { hint: setOpts.hint } : {}),
      };

      const actor: SessionUser = {
        id: setOpts.updatedBy ?? "system",
        tenantId,
        roles: SYSTEM_ROLES,
      };
      const tdb = createTenantDb(db, tenantId, "system");

      const existing = await lookup(tenantId, key);
      const commonFields = {
        envelope: stored,
        kekVersion: envelope.kekVersion,
        metadata,
        lastRotatedAt: Temporal.Now.instant(),
      };

      if (existing) {
        const result = await executor.update(
          {
            id: existing.id,
            version: existing.version,
            changes: commonFields,
          },
          actor,
          tdb,
        );
        if (!result.isSuccess) throw wrapSetFailure(result.error);
        // skip: update path done — don't fall through into the create branch below.
        return;
      }

      try {
        const result = await executor.create(
          {
            key,
            tenantId,
            ...commonFields,
          },
          actor,
          tdb,
        );
        if (!result.isSuccess) throw wrapSetFailure(result.error);
      } catch (err) {
        // Race-fallback: a concurrent set won the insert. Re-lookup and
        // convert to an update. The unique-index on (tenant, key) is what
        // triggers this path.
        const afterRace = await lookup(tenantId, key);
        if (!afterRace) throw err;
        const result = await executor.update(
          {
            id: afterRace.id,
            version: afterRace.version,
            changes: commonFields,
          },
          actor,
          tdb,
        );
        if (!result.isSuccess) throw wrapSetFailure(result.error);
      }
    },

    async delete(tenantId, keyOrHandle, deleteOpts = {}) {
      const key = resolveKey(keyOrHandle);
      const existing = await lookup(tenantId, key);
      if (!existing) return false;

      const actor: SessionUser = {
        id: deleteOpts.deletedBy ?? "system",
        tenantId,
        roles: SYSTEM_ROLES,
      };
      const tdb = createTenantDb(db, tenantId, "system");
      const result = await executor.delete({ id: existing.id }, actor, tdb);
      return result.isSuccess;
    },
  };
}

// Wrap an executor-level write failure into a KumikoError so callers of
// ctx.secrets.set / .delete can still branch on .code / details / i18nKey
// after it propagates up. Plain `new Error(...)` would have stripped the
// structured payload the error-contract promises.
function wrapSetFailure(err: WriteErrorInfo): InternalError {
  return new InternalError({
    message: `[secrets.set] executor returned failure: ${err.code}`,
    i18nKey: "secrets.errors.set_failed",
    details: { executorCode: err.code, executorDetails: err.details ?? {} },
  });
}
