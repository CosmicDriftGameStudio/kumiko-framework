import type { DbRow, DbTx } from "../db/connection";
import { hasAccess } from "../engine/access";
import { filterReadFields } from "../engine/field-access";
import type { SessionUser } from "../engine/types";
import { AccessDeniedError, NotFoundError, validationErrorFromZod } from "../errors";
import { assertNoSecretLeak } from "../secrets";
import type { DispatchContext } from "./dispatch-shared";
import {
  buildHandlerContext,
  enforceRateLimit,
  ensureFeatureEnabled,
  runHandlerInstrumented,
} from "./dispatch-shared";

// Standalone query execution — used by the public dispatcher.query() and
// by ctx.query/ctx.queryAs inside handlers. Runs the handler, applies
// field-level read filters for the given user, logs the event.
export async function executeQuery(
  ctx: DispatchContext,
  type: string,
  payload: unknown,
  user: SessionUser,
  tx?: DbTx,
): Promise<unknown> {
  return runHandlerInstrumented(ctx, type, "query", user, () =>
    executeQueryInner(ctx, type, payload, user, tx),
  );
}

async function executeQueryInner(
  ctx: DispatchContext,
  type: string,
  payload: unknown,
  user: SessionUser,
  tx?: DbTx,
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
  // wrapper turns into a 429 response. Inline-skip when the handler
  // didn't opt in — keeps the hot path zero-cost (no await on a
  // no-op promise).
  if (handler.rateLimit !== undefined) {
    await enforceRateLimit(ctx, handler.rateLimit, type, user);
  }

  // Default-deny: missing access rule is treated as "no one has access".
  // The registry boot-validator refuses to register handlers without one,
  // so in normal boots this branch shouldn't fire — the guard is belt-and-
  // suspenders in case a handler sneaks through (e.g. runtime injection).
  if (!hasAccess(user, handler.access)) {
    throw new AccessDeniedError({
      message: `access denied for ${type}`,
      details: { handler: type },
    });
  }

  const parsed = handler.schema.safeParse(payload);
  if (!parsed.success) {
    throw validationErrorFromZod(parsed.error);
  }

  // Trash opt-in rides the validated query payload: only the entity-list
  // schema (and custom query schemas that opt in) carries `includeDeleted`,
  // so other handlers never see the flag. Visibility filters still apply
  // downstream (see HandlerContext.includeDeleted) — safe from raw input.
  const includeDeleted =
    typeof parsed.data === "object" &&
    parsed.data !== null &&
    (parsed.data as Record<string, unknown>)["includeDeleted"] === true; // @cast-boundary validated-payload
  const handlerContext = buildHandlerContext(ctx, type, user, tx, undefined, includeDeleted);
  let result = await handler.handler({ type, payload: parsed.data, user }, handlerContext);

  // postQuery-Hooks: fire BEFORE field-access-filter so hooks see raw data
  // and can merge custom-fields/computed-counts/tags/etc. Each hook is
  // responsible for its own field-access on values it adds (the filter
  // below only knows the entity's stammfields).
  //
  // Two firing-pfade kombiniert in dieser Reihenfolge:
  //   1. Handler-keyed hooks via r.hook("postQuery", "ns:query:list", fn)
  //      — feuern nur für genau diesen handler
  //   2. Entity-keyed hooks via r.entityHook("postQuery", "property", fn)
  //      — feuern für ALLE query-handlers des entity
  const entityName = registry.getHandlerEntity(type);

  // Handler-keyed postQuery hooks fire for any query (incl. entity-less
  // standalone queries like "ns:dashboard"). Entity-keyed hooks only apply
  // when the handler maps to an entity — so this block must NOT be gated on
  // entityName, or hooks on standalone queries register silently and never fire.
  const handlerHooks = registry.getPostQueryHooks(type);
  const entityHooks = entityName ? registry.getEntityPostQueryHooks(entityName) : [];
  const postQueryHooks = [...handlerHooks, ...entityHooks];
  if (postQueryHooks.length > 0 && result && typeof result === "object") {
    if (Array.isArray(result)) {
      let rows = result as Record<string, unknown>[]; // @cast-boundary engine-payload
      for (const hook of postQueryHooks) {
        const out = await hook({ entityName, rows }, handlerContext);
        rows = [...out.rows];
      }
      result = rows;
    } else if (Array.isArray((result as { rows?: unknown }).rows)) {
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
  if (entity && result && typeof result === "object") {
    if (Array.isArray(result)) {
      result = result.map((row: Record<string, unknown>) => filterReadFields(entity, row, user));
    } else {
      const resultAsDbRow = result as DbRow; // @cast-boundary engine-payload
      if (Array.isArray((resultAsDbRow as { rows?: unknown }).rows)) {
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
