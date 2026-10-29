import type { EntityId } from "@cosmicdrift/kumiko-types/identifiers";
import type { TenantDb } from "@cosmicdrift/kumiko-types/tenant-db-types";
import type { ZodType } from "zod";
import type { UnavailableSelectOption } from "../engine/screen-helpers.ts";
import type { UnprocessableOpts } from "../errors/classes.ts";
import {
  VersionConflictError as FrameworkVersionConflict,
  UnprocessableError,
  ValidationError,
  type WriteFailure,
  writeFailure,
} from "../errors/index.ts";

import type { StoredEvent } from "../event-store/index.ts";
import {
  hasLiveProjectionsForEvent,
  runProjectionsForEvent,
} from "../pipeline/projections-runner.ts";
import type { DbRow, DbRunner } from "./connection.ts";
import { projectionRegistryOf } from "./projection-registry-binding.ts";
import { runInSavepointIfSupported } from "./query.ts";

// Custom projections for a write that did not go through the dispatcher (hook or
// job writing a second aggregate). Savepoint like applyEntityEvent: a throwing
// projection fails the write and the caller's transaction rolls it back.
export async function projectEntityEvent(
  db: TenantDb,
  runner: DbRunner,
  event: StoredEvent,
): Promise<void> {
  const registry = projectionRegistryOf(db);
  // skip: TenantDb not built by a dispatcher/job runner — nothing bound to project with
  if (!registry) return;
  // skip: no live projection listens — avoid a SAVEPOINT round trip on every plain write
  if (!hasLiveProjectionsForEvent(event, registry)) return;
  await runInSavepointIfSupported(runner, (sp) => runProjectionsForEvent(event, registry, sp));
}

export function selectOptionNotAvailableFailure(entries: readonly UnavailableSelectOption[]) {
  const [first] = entries;
  if (!first) return undefined;
  const i18nKey = "kumiko.validation.optionNotAvailable";
  return writeFailure(
    new UnprocessableError("select_option_not_available", {
      i18nKey,
      details: {
        field: first.field,
        value: first.value,
        allowed: first.allowed,
        fields: entries.map((entry) => ({
          path: entry.field,
          code: "select_option_not_available",
          i18nKey,
          params: { allowed: entry.allowed },
        })),
      },
    }),
  );
}

export function missingConditionalRequirementFailure(paths: readonly string[]) {
  if (paths.length === 0) return undefined;
  return writeFailure(
    new ValidationError({
      fields: paths.map((path) => ({
        path,
        code: "required",
        i18nKey: "kumiko.validation.required",
      })),
    }),
  );
}

export type PreSaveFn = (
  changes: Record<string, unknown>,
  previous: Record<string, unknown>,
  isNew: boolean,
) => Promise<Record<string, unknown>>;

// preSave runs before ownership checks: authorization must evaluate the row
// as it will actually be persisted, including hook-derived fields. A throwing
// hook is an app-author bug (bad business rule, not a framework fault) — map it
// to a clean writeFailure instead of letting it propagate as an internal_error
// 500.
export async function runPreSave(
  preSave: PreSaveFn | undefined,
  changes: Record<string, unknown>,
  previous: Record<string, unknown>,
  isNew: boolean,
  entityName: string,
  action: "create" | "update",
  outputSchema: () => ZodType,
): Promise<{ readonly data: DbRow } | { readonly failure: ReturnType<typeof writeFailure> }> {
  if (!preSave) return { data: changes as DbRow };
  try {
    const hookResult = await preSave(changes, previous, isNew);
    // A hook that echoes `id`/`version` back (e.g. `{ ...changes, id: x }`)
    // must not leak them into the persisted row — aggregateId already comes
    // from generateId()/the loaded row, not from hook output.
    const { id: _hookId, version: _hookVersion, ...safe } = hookResult;
    // Hook output skips the handler's input validation yet goes straight into the projection.
    // Validated only, not replaced by the parse result: hooks may set fields in storage form.
    const parsed = outputSchema().safeParse(safe);
    if (!parsed.success) {
      return {
        failure: writeFailure(
          new UnprocessableError("presave_hook_invalid_output", {
            i18nKey: "errors.presaveHookInvalidOutput",
            details: {
              entityName,
              action,
              handler: `${entityName}:${action}`,
              issues: parsed.error.issues.map((issue) => ({
                path: issue.path.join("."),
                message: issue.message,
              })),
            },
          }),
        ),
      };
    }
    return { data: safe as DbRow };
  } catch (e) {
    return {
      failure: writeFailure(
        new UnprocessableError("presave_hook_failed", {
          i18nKey: "errors.presaveHookFailed",
          details: { entityName, action, message: e instanceof Error ? e.message : String(e) },
        }),
      ),
    };
  }
}

export function ownershipDeniedFailure(
  details: NonNullable<UnprocessableOpts["details"]>,
): WriteFailure {
  return writeFailure(
    new UnprocessableError("ownership_denied", { i18nKey: "errors.ownershipDenied", details }),
  );
}

export function optimisticLockFailure(
  entityId: EntityId,
  submittedVersion: number | undefined,
  currentVersion: number,
  skip: boolean | undefined,
): WriteFailure | undefined {
  if (skip) return undefined;
  if (submittedVersion === undefined) {
    return writeFailure(
      new FrameworkVersionConflict({ entityId, expectedVersion: 0, currentVersion }),
    );
  }
  if (currentVersion !== submittedVersion) {
    return writeFailure(
      new FrameworkVersionConflict({ entityId, expectedVersion: submittedVersion, currentVersion }),
    );
  }
  return undefined;
}
