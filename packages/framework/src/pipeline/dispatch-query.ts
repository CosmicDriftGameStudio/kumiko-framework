import type { QueryHandlerDef } from "@cosmicdrift/kumiko-types/handlers";
import { isListAggregateResult } from "@cosmicdrift/kumiko-types/list-aggregate-types";
import { isPlainObject, propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import type { DbRow, DbTx } from "../db/connection.ts";
import { hasAccess } from "../engine/access.ts";
import { tenantOverrideDenied } from "../engine/cross-tenant.ts";
import { filterReadFields } from "../engine/field-access.ts";
import type { SessionUser } from "../engine/types/index.ts";

import { NotFoundError, validationErrorFromZod } from "../errors/index.ts";
import { assertNoSecretLeak } from "../secrets/leak-guard.ts";

import { runInDispatchScope } from "./dispatch-scope.ts";
import {
  buildHandlerContext,
  type DispatchContext,
  enforceRateLimit,
  ensureFeatureEnabled,
  isMemberResolutionPrincipal,
  runHandlerInstrumented,
  type WriteOrigin,
} from "./dispatch-shared.ts";
import type { AfterCommitHook } from "./dispatcher-utils.ts";
import { handlerAccessError } from "./handler-access-error.ts";
import { runInMemberReadOnlyTransaction } from "./member-read-only-transaction.ts";

// Standalone query execution — used by the public dispatcher.query() and
// by ctx.dispatch.query/ctx.dispatch.queryAs inside handlers. Runs the handler, applies
// field-level read filters for the given user, logs the event.
export async function executeQuery(
  ctx: DispatchContext,
  type: string,
  payload: unknown,
  user: SessionUser,
  origin: WriteOrigin,
  tx?: DbTx,
  outerNotifySink?: AfterCommitHook[],
): Promise<unknown> {
  return runInDispatchScope(ctx.registry, [type], user, () =>
    runHandlerInstrumented(ctx, type, "query", user, () =>
      executeQueryInner(ctx, type, payload, user, origin, tx, outerNotifySink),
    ),
  );
}

async function executeQueryInner(
  ctx: DispatchContext,
  type: string,
  payload: unknown,
  user: SessionUser,
  origin: WriteOrigin,
  tx?: DbTx,
  outerNotifySink?: AfterCommitHook[],
): Promise<unknown> {
  const { registry } = ctx;
  const handler = registry.getQueryHandler(type);
  if (!handler) throw new NotFoundError("handler", type);

  // Feature-toggle gate runs BEFORE rate-limit on purpose: calls to a
  // disabled feature must not consume the rate-limit quota — the call
  // never happened from the feature's perspective. Order is: lookup →
  // feature-gate → rate-limit → access → validation → handler.
  await ensureFeatureEnabled(ctx, type, user.tenantId);

  // Rate-limit gate runs BEFORE access-check on purpose: anonymous /
  // unauthorized callers must hit the cap too (otherwise the limit
  // would be a free probe-detector for valid credentials). The
  // resolver throws RateLimitError which the dispatcher's outer
  // wrapper turns into a 429 response. Apps that don't use L3 pay zero
  // cost for non-systemScope handlers with no rateLimit declared;
  // systemScope handlers pay one isHandlerSystemScoped lookup to check
  // whether the default per-tenant limit applies.
  await enforceRateLimit(ctx, handler.rateLimit, type, user, registry.isHandlerSystemScoped(type));

  // Default-deny: missing access rule is treated as "no one has access".
  // The registry boot-validator refuses to register handlers without one,
  // so in normal boots this branch shouldn't fire — the guard is belt-and-
  // suspenders in case a handler sneaks through (e.g. runtime injection).
  if (!hasAccess(user, handler.access)) {
    throw handlerAccessError(user, type);
  }

  const parsed = handler.schema.safeParse(payload);
  if (!parsed.success) {
    throw validationErrorFromZod(parsed.error);
  }

  const overrideDenied = tenantOverrideDenied(user, parsed.data);
  if (overrideDenied) throw overrideDenied;

  // Trash opt-in rides the validated query payload: only the entity-list
  // schema (and custom query schemas that opt in) carries `includeDeleted`,
  // so other handlers never see the flag. Visibility filters still apply
  // downstream (see HandlerContext.includeDeleted) — safe from raw input.
  const includeDeleted = propertyOf(parsed.data, "includeDeleted") === true;

  // A resolved member (ctx.dispatch.queryAsMember) runs in a Postgres READ ONLY transaction, not just the ctx surface below.
  return isMemberResolutionPrincipal(user)
    ? runInMemberReadOnlyTransaction(ctx, tx, (readOnlyTx) =>
        runQueryHandler(ctx, type, handler, parsed.data, includeDeleted, user, origin, readOnlyTx),
      )
    : runQueryHandler(
        ctx,
        type,
        handler,
        parsed.data,
        includeDeleted,
        user,
        origin,
        tx,
        outerNotifySink,
      );
}

async function runQueryHandler(
  ctx: DispatchContext,
  type: string,
  handler: QueryHandlerDef,
  payload: unknown,
  includeDeleted: boolean,
  user: SessionUser,
  origin: WriteOrigin,
  tx: DbTx | undefined,
  outerNotifySink?: AfterCommitHook[],
): Promise<unknown> {
  const { registry } = ctx;
  const handlerContext = await buildHandlerContext(ctx, type, user, origin, {
    tx,
    includeDeleted,
    outerNotifySink,
  });
  let result = await handler.handler({ type, payload, user }, handlerContext);

  // postQuery hooks run BEFORE field-access filtering so they see raw data and can
  // merge custom fields, computed counts, tags, and similar values. Each hook is
  // responsible for applying field access to values it adds; the filter below
  // only knows the entity's standard fields.
  //
  // Two hook scopes run in this order:
  //   1. Handler-keyed hooks via r.hook({ type: "postQuery", target: "ns:query:list", handler })
  //      — run only for that handler
  //   2. Entity-keyed hooks via r.entityHook("postQuery", "property", fn)
  //      — run for all query handlers of the entity
  const entityName = registry.getHandlerEntity(type);

  // Handler-keyed postQuery hooks fire for any query (incl. entity-less
  // standalone queries like "ns:dashboard"). Entity-keyed hooks only apply
  // when the handler maps to an entity — so this block must NOT be gated on
  // entityName, or hooks on standalone queries register silently and never fire.
  const handlerHooks = registry.getPostQueryHooks(type);
  const entityHooks = entityName ? registry.getEntityPostQueryHooks(entityName) : [];
  const postQueryHooks = [...handlerHooks, ...entityHooks];
  // Aggregate groups are not rows: their values are already read-gated and the hooks are row-shaped.
  const isAggregate = isListAggregateResult(result);
  if (!isAggregate && postQueryHooks.length > 0 && result && typeof result === "object") {
    if (Array.isArray(result)) {
      let rows = result as Record<string, unknown>[]; // @cast-boundary engine-payload
      for (const hook of postQueryHooks) {
        const out = await hook({ entityName, rows }, handlerContext);
        rows = [...out.rows];
      }
      result = rows;
    } else if (isPlainObject(result) && Array.isArray(result["rows"])) {
      // @cast-boundary engine-payload
      const r = result as { rows: Record<string, unknown>[]; nextCursor: string | null };
      let rows = r.rows;
      for (const hook of postQueryHooks) {
        const out = await hook({ entityName, rows }, handlerContext);
        rows = [...out.rows];
      }
      result = { ...r, rows };
    } else {
      let rows: Record<string, unknown>[] = [result as Record<string, unknown>]; // @cast-boundary engine-payload
      for (const hook of postQueryHooks) {
        const out = await hook({ entityName, rows }, handlerContext);
        rows = [...out.rows];
      }
      // A single-object result carries exactly one row through the hook
      // pipeline. Returning 0 rows (effect lost) or ≥2 rows (extras
      // dropped) cannot be represented in the single-object response —
      // surface it instead of silently falling back / truncating.
      if (rows.length !== 1) {
        throw new Error(
          `postQuery hook on single-object result for "${type}" must return exactly one row, got ${rows.length}`,
        );
      }
      result = rows[0];
    }
  }

  // Field-level read filter — only applies to entity-bound results.
  const entity = entityName ? registry.getEntity(entityName) : undefined;
  if (entity && !isAggregate && result && typeof result === "object") {
    if (Array.isArray(result)) {
      result = result.map((row: Record<string, unknown>) => filterReadFields(entity, row, user));
    } else {
      const resultAsDbRow = result as DbRow; // @cast-boundary engine-payload
      if (Array.isArray(resultAsDbRow["rows"])) {
        // generic handler-result shape narrow
        const r = result as { rows: Record<string, unknown>[]; nextCursor: string | null }; // @cast-boundary engine-payload
        result = {
          ...r,
          rows: r.rows.map((row) => filterReadFields(entity, row, user)),
        };
      } else {
        result = filterReadFields(entity, result as DbRow, user); // @cast-boundary engine-payload
      }
    }
  }

  // Response-guard: fail the request if a handler accidentally included
  // a Secret<> branded value in its return. Must run AFTER field-access
  // filtering so a legitimately stripped secret doesn't false-positive.
  assertNoSecretLeak(result);
  return result;
}
