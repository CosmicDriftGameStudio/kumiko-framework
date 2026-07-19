import { requestContext } from "@cosmicdrift/kumiko-framework/api";
import {
  configuredPiiSubjectKms,
  encryptPiiValueForSubject,
  type KmsContext,
  type SubjectId,
} from "@cosmicdrift/kumiko-framework/crypto";
import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import {
  ConfigScopes,
  defineWriteHandler,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  InternalError,
  UnprocessableError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { requireConfigEncryption } from "../feature";
import { configValueEntity, configValuesTable } from "../table";
import {
  findConfigRow,
  prepareConfigWrite,
  validateBounds,
  validatePattern,
  validateScope,
  validateType,
} from "../write-helpers";

const scopeEnum = z.enum([ConfigScopes.system, ConfigScopes.tenant, ConfigScopes.user]);

const executor = createEventStoreExecutor(configValuesTable, configValueEntity, {
  entityName: "config-value",
});

export const setWrite = defineWriteHandler({
  name: "set",
  schema: z.object({
    key: z.string(),
    value: z.union([z.string(), z.number(), z.boolean()]),
    scope: scopeEnum.optional(),
  }),
  // Per-key access enforcement lives inside the handler via checkWriteAccess.
  access: { openToAll: true },
  handler: async (event, ctx) => {
    const db = ctx.db;

    const prep = prepareConfigWrite({
      registry: ctx.registry,
      user: event.user,
      key: event.payload.key,
      scope: event.payload.scope,
    });
    if (!prep.ok) return prep.failure;
    const { keyDef, scope, tenantId, userId } = prep;

    const scopeError = validateScope(scope, keyDef.scope, event.payload.key);
    if (scopeError) return writeFailure(scopeError);

    // A piiEncrypted key can never be defined with scope="system" (boot-
    // rejected), but an admin override write can still target scope=
    // "system" for a tenant/user-scoped key (validateScope allows any
    // requestedScope <= definedScope) — system-row has no subject.
    if (keyDef.piiEncrypted && scope === ConfigScopes.system) {
      return writeFailure(
        new UnprocessableError("invalid_scope", {
          i18nKey: "config.errors.invalidScope",
          details: { key: event.payload.key, definedScope: keyDef.scope, requestedScope: scope },
        }),
      );
    }

    const typeError = validateType(event.payload.value, keyDef);
    if (typeError) return writeFailure(typeError);

    // Bounds enforcement: hard-reject (not silent-clamp). A caller that
    // sends 9999 for a bounds.max=1000 key should see a 422 and fix their
    // input — silent clamping would make `get` return a different value
    // than what was sent, which is a UX trap with no upside.
    const boundsError = validateBounds(event.payload.value, keyDef);
    if (boundsError) return writeFailure(boundsError);

    const patternError = validatePattern(event.payload.value, keyDef);
    if (patternError) return writeFailure(patternError);

    // backing="secrets": persist into the secrets store (system tenant, own
    // envelope encryption + audit) instead of config_values. Same JSON
    // serialization as a config row so the read path round-trips via
    // deserializeValue. system-scope is guaranteed by the boot-guard.
    if (keyDef.backing === "secrets") {
      if (!ctx.secrets) {
        throw new InternalError({
          message:
            `[config:write:set] key "${event.payload.key}" declares backing="secrets" but ` +
            `ctx.secrets is not wired — provide extraContext.secrets (and a MasterKeyProvider).`,
        });
      }
      await ctx.secrets.set(
        SYSTEM_TENANT_ID,
        event.payload.key,
        JSON.stringify(event.payload.value),
        {
          updatedBy: event.user.id,
        },
      );
      return {
        isSuccess: true,
        data: { key: event.payload.key, value: event.payload.value, scope },
      };
    }

    let serialized = JSON.stringify(event.payload.value);
    if (keyDef.encrypted) {
      const cipher = requireConfigEncryption(ctx, "config:write:set");
      serialized = await cipher.encrypt(serialized, { tenantId });
    } else if (keyDef.piiEncrypted) {
      const kms = configuredPiiSubjectKms();
      if (!kms) {
        throw new InternalError({
          message:
            `[config:write:set] key "${event.payload.key}" declares piiEncrypted=true but no ` +
            `PII subject-KMS is configured — pass one via runProdApp({ kms }) / ` +
            `configurePiiSubjectKms(adapter) at boot.`,
        });
      }
      // scope=system was already rejected above, so scope is "tenant" or
      // "user" here — resolveScopeIds guarantees userId is set for "user".
      const subject: SubjectId =
        scope === ConfigScopes.user
          ? { kind: "user", userId: userId as string }
          : { kind: "tenant", tenantId };
      const kmsCtx: KmsContext = {
        requestId: requestContext.get()?.requestId ?? "config:write:set",
        tenantId,
        userId: String(event.user.id),
      };
      serialized = await encryptPiiValueForSubject(kms, subject, serialized, kmsCtx);
    }

    const existing = await findConfigRow(db, event.payload.key, tenantId, userId);

    if (existing) {
      // skipOptimisticLock: config is single-writer operator state, not a
      // collaboratively-edited aggregate — last-write-wins is the intended
      // semantics. More importantly, the optimistic check compares the
      // PROJECTION version (existing.version) against the event-stream
      // version; if those drift (a migration/seed that wrote the read-row
      // outside the normal event flow — e.g. the Stripe config cut-over),
      // every save would version-conflict forever. Appending at the real
      // stream version resyncs the projection and self-heals the drift.
      const result = await executor.update(
        {
          id: existing.id,
          version: existing.version,
          changes: { value: serialized },
        },
        event.user,
        db,
        { skipOptimisticLock: true },
      );
      if (!result.isSuccess) return result;
    } else {
      const result = await executor.create(
        {
          key: event.payload.key,
          value: serialized,
          tenantId,
          userId,
        },
        event.user,
        db,
      );
      if (!result.isSuccess) return result;
    }

    return {
      isSuccess: true,
      data: { key: event.payload.key, value: event.payload.value, scope },
    };
  },
});
