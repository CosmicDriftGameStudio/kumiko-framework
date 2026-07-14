import type { DbRow, DbTx } from "../db/connection";
import { selectRowForUpdateById } from "../db/queries/entity-read";
import { asEntityTableMeta, selectMany } from "../db/query";
import { buildEntityTable, toSnakeCase } from "../db/table-builder";
import { hasAccess } from "../engine/access";
import { checkWriteFieldRoles } from "../engine/field-access";
import { defineTransitions, guardTransition } from "../engine/state-machine";
import type { HandlerContext, SessionUser, WriteResult } from "../engine/types";
import { HookPhases } from "../engine/types";
import { runValidation } from "../engine/validation";
import {
  AccessDeniedError,
  FrameworkReasons,
  InternalError,
  isKumikoError,
  NotFoundError,
  ValidationError,
  validationErrorFromZod,
  writeFailure,
} from "../errors";
import { assertNoSecretLeak } from "../secrets";
import type { DispatchContext } from "./dispatch-shared";
import {
  buildHandlerContext,
  checkFeatureEnabled,
  enforceRateLimit,
  runHandlerInstrumented,
} from "./dispatch-shared";
import {
  type AfterCommitHook,
  describeShape,
  extractNestedSpecs,
  isLifecycleResult,
  isWriteResultShape,
  prefixValidationPath,
  wrapToKumiko,
} from "./dispatcher-utils";
import { runProjections } from "./projections-runner";

function getTable(
  ctx: DispatchContext,
  entityName: string,
): ReturnType<typeof buildEntityTable> | undefined {
  const { registry, tableCache } = ctx;
  if (tableCache.has(entityName)) return tableCache.get(entityName);
  const entity = registry.getEntity(entityName);
  if (!entity) return undefined;
  const table = buildEntityTable(entityName, entity, {
    relations: registry.getRelations(entityName),
  });
  tableCache.set(entityName, table);
  return table;
}

function getTransitions(
  ctx: DispatchContext,
  args: {
    entityName: string;
    fieldName: string;
    map: Record<string, readonly string[]>;
  },
): ReturnType<typeof defineTransitions> {
  const { transitionCache } = ctx;
  // Scope by entity — `fieldName` alone collides across entities (e.g. both
  // `invoice.status` and `driverOrder.status` exist with different maps),
  // which would apply the wrong transition rules to whichever entity arrives
  // second.
  const key = `${args.entityName}:${args.fieldName}`;
  const cached = transitionCache.get(key);
  if (cached) return cached;
  const transitions = defineTransitions(args.map);
  transitionCache.set(key, transitions);
  return transitions;
}

// Runs lifecycle hooks for a handler result. inTransaction hooks fire NOW
// (they see the tx via ctx.db when batch/write opens a transaction).
// afterCommit hooks are queued into `afterCommitHooks` for the caller to
// flush after commit.
async function runLifecycle(
  ctx: DispatchContext,
  type: string,
  data: unknown,
  handlerContext: HandlerContext,
  afterCommitHooks: AfterCommitHook[],
): Promise<void> {
  const { lifecycle } = ctx;
  if (!lifecycle) {
    handlerContext.log?.debug(`runLifecycle: skipping ${type} — no lifecycle pipeline`);
    return;
  }
  if (!isLifecycleResult(data)) {
    handlerContext.log?.debug(`runLifecycle: skipping ${type} — result is not a lifecycle kind`);
    return;
  }
  const result = data;

  // Projections run FIRST, inside the tx, before any user postSave/postDelete
  // hooks. If a projection apply() throws, the whole tx rolls back — the
  // event and the auto-projection row go with it. Running before the hooks
  // keeps projection state consistent with what the hooks observe.
  await runProjections(result, handlerContext);

  if (result.kind === "save") {
    await lifecycle.runPostSave(type, result, handlerContext, HookPhases.inTransaction);
    afterCommitHooks.push(() =>
      lifecycle.runPostSave(type, result, handlerContext, HookPhases.afterCommit),
    );
  } else if (result.kind === "delete") {
    await lifecycle.runPreDelete(type, result, handlerContext);
    await lifecycle.runPostDelete(type, result, handlerContext, HookPhases.inTransaction);
    afterCommitHooks.push(() =>
      lifecycle.runPostDelete(type, result, handlerContext, HookPhases.afterCommit),
    );
  }
}

// Shared write pipeline: validates, executes handler, runs lifecycle + side effects.
// Used by runBatch (which opens a transaction and flushes afterCommitHooks on commit).
//
// Contract:
//   - `tx` is the active Drizzle transaction handle (or undefined for the no-DB
//     fallback path used by tests without a Postgres connection).
//   - `afterCommitHooks` collects deferred side-effects that must only fire
//     after the transaction commits. The caller flushes them on commit, drops
//     them on rollback. executeWrite never fires them directly.
export async function executeWrite(
  ctx: DispatchContext,
  type: string,
  payload: unknown,
  user: SessionUser,
  tx: DbTx | undefined,
  afterCommitHooks: AfterCommitHook[],
): Promise<WriteResult> {
  return runHandlerInstrumented(ctx, type, "write", user, () =>
    executeWriteInner(ctx, type, payload, user, tx, afterCommitHooks),
  );
}

// Nested-write orchestration (v1: depth=1, create-only, hasMany-only).
//
// When a parent `:create` handler's payload carries values under keys
// declared as `hasMany` relations with `nestedWrite: true`, those values
// are expanded into child writes: parent first (so its new id exists),
// then each nested entry as a separate `<target>:create` write with the
// foreign key set by the framework — never taken from the client. All of
// this runs inside the caller's transaction, so a child failure rolls the
// parent (and any earlier children) back together.
//
// This wrapper is what runBatch calls, not executeWrite. Single writes
// (`dispatcher.write`) flow through runBatch as batch-of-one, so they get
// nested-expansion too for free. A batch with N heterogeneous commands
// can each independently carry nested-children — all still one TX.
export async function executeNestedWrite(
  ctx: DispatchContext,
  type: string,
  payload: unknown,
  user: SessionUser,
  tx: DbTx | undefined,
  afterCommitHooks: AfterCommitHook[],
): Promise<WriteResult> {
  const { registry } = ctx;
  const nested = extractNestedSpecs(type, payload, registry);
  if (!nested) return executeWrite(ctx, type, payload, user, tx, afterCommitHooks);

  // Pre-flight client-shape checks. Merge non-array issues (collected up
  // front by extractNestedSpecs) with fk-injection issues into one error
  // so the client sees every problem in a single round-trip.
  //
  // Security rail: the client MUST NOT supply the foreign key on nested
  // items. The framework binds it from the parent's new id. Silent-overwrite
  // would mask an attempt to attach children to a different parent — fail
  // loud with a ValidationError carrying a client-mappable path.
  const issues: Array<{ path: string; code: string; i18nKey: string }> = [...nested.typeIssues];
  for (const spec of nested.specs) {
    for (let i = 0; i < spec.items.length; i++) {
      const item = spec.items[i];
      if (item && typeof item === "object" && spec.foreignKey in item) {
        issues.push({
          path: `${spec.key}.${i}.${spec.foreignKey}`,
          code: "unexpected_field",
          i18nKey: "errors.validation.unexpected_field",
        });
      }
    }
  }
  if (issues.length > 0) {
    return writeFailure(new ValidationError({ fields: issues }));
  }

  const parentResult = await executeWrite(
    ctx,
    type,
    nested.cleanPayload,
    user,
    tx,
    afterCommitHooks,
  );
  if (!parentResult.isSuccess) return parentResult;

  // Handlers built on the CRUD executor return a SaveContext wrapper —
  // `{ kind: "save", id, data: <row>, changes, previous, event, ... }`.
  // The wrapper is load-bearing for batch-level hooks downstream (see
  // flushBatchHooks), so we mutate in place: nested children land on the
  // inner `data` (which mirrors the entity shape the client expects) while
  // the wrapper keeps its SaveContext semantics intact for the lifecycle
  // pipeline. For handlers that return a bare row (no wrapper), children
  // land directly on that object.
  //
  // Hook-ordering note: per-entity postSave hooks already ran inside the
  // parent's executeWrite call above — they never saw `tasks`, which is
  // the right semantic (postSave gets the entity's own columns, not
  // synthetic relation keys). A future postSaveBatch subscriber that
  // enumerates columns generically WOULD see `tasks`; no such subscriber
  // exists today. If you add one that iterates `Object.keys(save.data)`,
  // filter by `entity.fields` membership to stay correct.
  // handler-Result.data ist generic über alle Entity-Handler; nested-
  // write inspiziert die shape strukturell.
  const parentWrapper = parentResult.data as Record<string, unknown>; // @cast-boundary engine-payload
  const parentRow = (parentWrapper["data"] ?? parentWrapper) as Record<string, unknown>; // @cast-boundary engine-payload
  const parentId = parentRow["id"];
  if (typeof parentId !== "string") {
    return writeFailure(
      new InternalError({
        message: `nested-write: parent handler "${type}" returned no string "id" — cannot attach children`,
      }),
    );
  }

  for (const spec of nested.specs) {
    const subRows: Record<string, unknown>[] = [];
    for (let i = 0; i < spec.items.length; i++) {
      const rawItem = spec.items[i];
      const itemObj = (rawItem ?? {}) as Record<string, unknown>; // @cast-boundary engine-payload
      const subPayload = { ...itemObj, [spec.foreignKey]: parentId };
      const subResult = await executeWrite(
        ctx,
        spec.subType,
        subPayload,
        user,
        tx,
        afterCommitHooks,
      );
      if (!subResult.isSuccess) {
        return {
          isSuccess: false,
          error: prefixValidationPath(subResult.error, `${spec.key}.${i}`),
        };
      }
      const subWrapper = subResult.data as Record<string, unknown>; // @cast-boundary engine-payload
      const subRow = (subWrapper["data"] ?? subWrapper) as Record<string, unknown>; // @cast-boundary engine-payload
      subRows.push(subRow);
    }
    parentRow[spec.key] = subRows;
  }

  return parentResult;
}

async function executeWriteInner(
  ctx: DispatchContext,
  type: string,
  payload: unknown,
  user: SessionUser,
  tx: DbTx | undefined,
  afterCommitHooks: AfterCommitHook[],
): Promise<WriteResult> {
  const { registry, jobRunner } = ctx;
  const handler = registry.getWriteHandler(type);
  if (!handler) return writeFailure(new NotFoundError("handler", type));

  // Feature-toggle gate: disabled handlers must short-circuit before any
  // rate-limit/access/validation work — see executeQueryInner comment.
  const disabledErr = await checkFeatureEnabled(ctx, type, user.tenantId);
  if (disabledErr) return writeFailure(disabledErr);

  // Rate-limit gate before access (same reasoning as in executeQueryInner).
  // Throws RateLimitError; the outer wrapper turns it into a 429
  // WriteFailure via toWriteErrorInfo. Inline-skip when no opt-in —
  // hot path stays zero-cost.
  if (handler.rateLimit !== undefined) {
    try {
      await enforceRateLimit(ctx, handler.rateLimit, type, user);
    } catch (e) {
      if (isKumikoError(e)) return writeFailure(e);
      throw e;
    }
  }

  // Default-deny: missing access rule is treated as "no one has access".
  // The registry boot-validator refuses to register handlers without one,
  // so in normal boots this branch shouldn't fire — the guard is belt-and-
  // suspenders in case a handler sneaks through (e.g. runtime injection).
  if (!hasAccess(user, handler.access)) {
    return writeFailure(
      new AccessDeniedError({
        message: `access denied for ${type}`,
        details: { handler: type },
      }),
    );
  }

  const parsed = handler.schema.safeParse(payload);
  if (!parsed.success) {
    return writeFailure(validationErrorFromZod(parsed.error));
  }

  const hookErrors = runValidation(registry, type, parsed.data as DbRow); // @cast-boundary engine-payload
  if (hookErrors) {
    return writeFailure(
      new ValidationError({
        fields: hookErrors.map((e) => ({
          path: e.field,
          code: e.error,
          i18nKey: `errors.validation.${e.error}`,
        })),
      }),
    );
  }

  // Field-level write access check
  const entityName = registry.getHandlerEntity(type);
  if (entityName) {
    const entity = registry.getEntity(entityName);
    if (entity) {
      const fieldsToCheck = (parsed.data as DbRow)["changes"] as
        | Record<string, unknown>
        | undefined; // @cast-boundary engine-payload
      const writePayload = fieldsToCheck ?? (parsed.data as DbRow); // @cast-boundary engine-payload
      // Pre-handler check: role-only gate. Ownership-level row-match runs
      // later in the executor where oldRow is loaded — that split lets
      // updates with partial changes still pass the pre-handler check and
      // get their full evaluation at save time.
      const deniedField = checkWriteFieldRoles(entity, writePayload, user);
      if (deniedField) {
        return writeFailure(
          new AccessDeniedError({
            message: `field access denied: ${deniedField}`,
            i18nKey: "errors.access.fieldDenied",
            details: {
              reason: FrameworkReasons.fieldAccessDenied,
              field: deniedField,
              handler: type,
            },
          }),
        );
      }
    }
  }

  const handlerContext = buildHandlerContext(ctx, type, user, tx, afterCommitHooks);

  // Auto transition guard: if entity has transitions and handler doesn't skip it
  if (entityName && !handler.unsafeSkipTransitionGuard) {
    const entity = registry.getEntity(entityName);
    if (entity?.transitions && handlerContext.db) {
      const parsedData = parsed.data as DbRow; // @cast-boundary engine-payload
      const changes = (parsedData["changes"] as DbRow) ?? parsedData; // @cast-boundary engine-payload
      const id = (parsedData["id"] as number) ?? undefined; // @cast-boundary engine-payload

      for (const [fieldName, transitionMap] of Object.entries(entity.transitions)) {
        const newValue = changes[fieldName] as string | undefined; // @cast-boundary engine-bridge
        if (!newValue || !id) continue;

        const table = getTable(ctx, entityName);
        if (!table) continue;

        // SELECT FOR UPDATE inside the surrounding transaction — locks the
        // row so a concurrent handler can't mutate `status` between our
        // guard check and the handler's UPDATE. Without this lock the guard
        // can false-pass; optimistic locking would catch it later, but with
        // a less specific error. Falls back to a plain SELECT if no tx is
        // active (tests without a DB connection).
        const tableName = asEntityTableMeta(table)?.tableName ?? "";
        const rows = tx
          ? await selectRowForUpdateById(handlerContext.db, tableName, id)
          : await selectMany(handlerContext.db, table, { id });
        const row = rows[0];

        if (!row) continue;
        // Skip guard for soft-deleted rows — they shouldn't be transitioning
        // at all; a handler that wants to move a deleted row should use
        // unsafeSkipTransitionGuard or restore first.
        const rowAsRow = row as DbRow; // @cast-boundary engine-payload
        const isDeleted = rowAsRow["isDeleted"] ?? rowAsRow["is_deleted"];
        if (entity.softDelete && isDeleted === true) {
          continue;
        }
        const currentValue =
          ((row as DbRow)[fieldName] as string | undefined) ??
          ((row as DbRow)[toSnakeCase(fieldName)] as string); // @cast-boundary engine-bridge
        guardTransition(
          getTransitions(ctx, { entityName, fieldName, map: transitionMap }),
          currentValue,
          newValue,
        );
      }
    }
  }

  // The handler itself plus the lifecycle pipeline run under the same
  // try-wrapper: any KumikoError bubbles up as a typed WriteErrorInfo, any
  // other throw gets wrapped in InternalError so the Prod contract holds
  // ("unexpected throw → 500 with sanitized body"). We intentionally do NOT
  // catch further out (runBatch still sees these as exceptions via
  // writeFailure, not via a rethrow) so batches roll back naturally.
  let result: WriteResult;
  try {
    result = await handler.handler({ type, payload: parsed.data, user }, handlerContext);
  } catch (e) {
    return writeFailure(wrapToKumiko(e));
  }

  // Runtime shape-guard. The compile-time type WriteHandlerFn already
  // requires `Promise<WriteResult>`, but custom handlers wired through
  // r.writeHandler(name, schema, fn, opts) sometimes slip through with
  // `Promise<{id: string}>` — TypeScript misses it under structural-
  // widening, the dispatcher then reads .isSuccess on undefined and
  // crashes obscure. Surface a clear actionable message instead.
  if (!isWriteResultShape(result)) {
    return writeFailure(
      new InternalError({
        message:
          `Write handler "${type}" returned an invalid shape. Expected WriteResult ` +
          `({ isSuccess: true, data: ... } or writeFailure(err)), got ${describeShape(result)}. ` +
          `Use defineWriteHandler() or wrap the return as { isSuccess: true as const, data: ... }.`,
      }),
    );
  }

  if (result.isSuccess) {
    try {
      await runLifecycle(ctx, type, result.data, handlerContext, afterCommitHooks);
    } catch (e) {
      return writeFailure(wrapToKumiko(e));
    }

    // jobRunner has external side-effects (BullMQ enqueue) — must NOT
    // fire for rolled-back writes. Defer to afterCommit.
    if (jobRunner) {
      const eventData = (parsed.data ?? {}) as DbRow; // @cast-boundary engine-payload
      afterCommitHooks.push(() => jobRunner.handleEvent(type, eventData, user));
    }
  }

  // Response-guard: block Secret<> leaks in write responses (SaveContext
  // data / previous / changes). Feature code that fed a plaintext through
  // to the return payload fails here instead of hitting the client.
  if (result.isSuccess) assertNoSecretLeak(result.data);
  return result;
}
