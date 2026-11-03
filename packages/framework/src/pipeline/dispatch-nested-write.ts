import type { WriteResult } from "@cosmicdrift/kumiko-types/handlers";
import type { DbTx } from "../db/connection.ts";
import { maskWriteOnlyFields } from "../engine/field-access.ts";
import type { SessionUser } from "../engine/types/index.ts";
import { InternalError, ValidationError, writeFailure } from "../errors/index.ts";
import type { DispatchContext, WriteOrigin } from "./dispatch-shared.ts";
import { executeWrite } from "./dispatch-write.ts";
import {
  type AfterCommitHook,
  extractNestedSpecs,
  prefixValidationPath,
} from "./dispatcher-utils.ts";
import { rejectUnverifiedParent } from "./nested-write-parent-guard.ts";

function collectNestedForeignKeyIssues(
  nested: NonNullable<ReturnType<typeof extractNestedSpecs>>,
): Array<{ path: string; code: string; i18nKey: string }> {
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
  return issues;
}

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
// parent's executeWrite call — they never saw `tasks`, which is
// the right semantic (postSave gets the entity's own columns, not
// synthetic relation keys). A future postSaveBatch subscriber that
// enumerates columns generically WOULD see `tasks`; no such subscriber
// exists today. If you add one that iterates `Object.keys(save.data)`,
// filter by `entity.fields` membership to stay correct.
// handler-Result.data is generic across all entity handlers; nested-
// write inspects the shape structurally.
export function unwrapSaveRow(data: unknown): Record<string, unknown> {
  const wrapper = data as Record<string, unknown>; // @cast-boundary engine-payload
  return (wrapper["data"] ?? wrapper) as Record<string, unknown>; // @cast-boundary engine-payload
}

async function writeNestedChildren(
  ctx: DispatchContext,
  spec: NonNullable<ReturnType<typeof extractNestedSpecs>>["specs"][number],
  parentId: string,
  user: SessionUser,
  origin: WriteOrigin,
  tx: DbTx | undefined,
  afterCommitHooks: AfterCommitHook[],
): Promise<
  | { readonly kind: "failed"; readonly failure: WriteResult }
  | { readonly kind: "written"; readonly rows: Record<string, unknown>[] }
> {
  const { registry } = ctx;
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
      origin,
      tx,
      afterCommitHooks,
    );
    if (!subResult.isSuccess) {
      return {
        kind: "failed",
        failure: {
          isSuccess: false,
          error: prefixValidationPath(subResult.error, `${spec.key}.${i}`),
        },
      };
    }
    const subRow = unwrapSaveRow(subResult.data);
    const subEntityName = registry.getHandlerEntity(spec.subType);
    const subEntity = subEntityName ? registry.getEntity(subEntityName) : undefined;
    // parentRow is returned to the client; the child's own SaveContext keeps the plaintext.
    subRows.push(subEntity ? maskWriteOnlyFields(subEntity, subRow) : subRow);
  }
  return { kind: "written", rows: subRows };
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
  origin: WriteOrigin,
  tx: DbTx | undefined,
  afterCommitHooks: AfterCommitHook[],
): Promise<WriteResult> {
  const nested = extractNestedSpecs(type, payload, ctx.registry);
  if (!nested) return executeWrite(ctx, type, payload, user, origin, tx, afterCommitHooks);

  const issues = collectNestedForeignKeyIssues(nested);
  if (issues.length > 0) {
    return writeFailure(new ValidationError({ fields: issues }));
  }

  const parentResult = await executeWrite(
    ctx,
    type,
    nested.cleanPayload,
    user,
    origin,
    tx,
    afterCommitHooks,
  );
  if (!parentResult.isSuccess) return parentResult;

  const parentRow = unwrapSaveRow(parentResult.data);
  const parentId = parentRow["id"];
  if (typeof parentId !== "string") {
    return writeFailure(
      new InternalError({
        message: `nested-write: parent handler "${type}" returned no string "id" — cannot attach children`,
      }),
    );
  }

  const parentRejection = await rejectUnverifiedParent(ctx, type, parentRow, parentId, user, tx);
  if (parentRejection) return parentRejection;

  for (const spec of nested.specs) {
    const children = await writeNestedChildren(
      ctx,
      spec,
      parentId,
      user,
      origin,
      tx,
      afterCommitHooks,
    );
    if (children.kind === "failed") return children.failure;
    parentRow[spec.key] = children.rows;
  }

  return parentResult;
}
