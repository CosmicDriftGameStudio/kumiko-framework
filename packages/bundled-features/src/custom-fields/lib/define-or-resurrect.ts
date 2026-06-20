import { fieldDefinitionExecutor } from "../executor";
import type { FieldDefinitionColumns } from "./field-definition-row";

type DefineUser = Parameters<typeof fieldDefinitionExecutor.create>[1];
type DefineDb = Parameters<typeof fieldDefinitionExecutor.create>[2];
type WriteResult = Awaited<ReturnType<typeof fieldDefinitionExecutor.create>>;

// Resurrection-aware define for the deterministic fieldDefinition aggregate-id.
//
// A definition's id is uuidv5(tenant|entity|fieldKey), so deleting it leaves a
// (created+deleted) event stream under that id. A plain create() appends at
// version 0 onto that stream → version_conflict — the deleted (entity, fieldKey)
// could never be re-defined. The lifecycle states and their handling:
//   - active definition exists → let create() raise the natural version_conflict
//     (409) the dedup contract relies on.
//   - soft-deleted definition  → restore() the stream, then update() it to the
//     new payload (the caller is defining it afresh).
//   - never defined            → create().
//
// restore-before-create matters: a create() version_conflict aborts the
// surrounding tx, so a follow-up restore()/update() on the same connection would
// fail with "current transaction is aborted". detail() (a read) + restore()
// (which sees soft-deleted rows via selectMany and only writes on success) keep
// the tx clean until the single terminal write.
export async function defineOrResurrectFieldDefinition(
  aggregateId: string,
  columns: FieldDefinitionColumns,
  user: DefineUser,
  db: DefineDb,
): Promise<WriteResult> {
  const active = await fieldDefinitionExecutor.detail({ id: aggregateId }, user, db);
  if (active) {
    return fieldDefinitionExecutor.create({ id: aggregateId, ...columns }, user, db);
  }

  const restored = await fieldDefinitionExecutor.restore({ id: aggregateId }, user, db);
  if (restored.isSuccess) {
    // restore() just un-deleted the row in this same tx; no concurrent writer
    // exists, so skip the optimistic-lock version match (we'd otherwise have to
    // thread the post-restore stream version through). Overwrite with the new
    // definition payload — the caller is defining the field afresh.
    // Spread to a mutable copy: `changes` is Record<string, unknown> and the
    // readonly FieldDefinitionColumns isn't assignable to it.
    return fieldDefinitionExecutor.update({ id: aggregateId, changes: { ...columns } }, user, db, {
      skipOptimisticLock: true,
    });
  }
  if (restored.error.code === "not_found") {
    return fieldDefinitionExecutor.create({ id: aggregateId, ...columns }, user, db);
  }
  return restored;
}
