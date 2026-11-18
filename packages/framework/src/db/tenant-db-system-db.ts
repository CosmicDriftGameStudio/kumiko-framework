import type {
  EscapeHatchDeclaration,
  EscapeHatchReporter,
} from "@cosmicdrift/kumiko-types/handlers";
import {
  SYSTEM_SCOPE_CHECK_BRAND,
  type TenantDb,
  type UncheckedSystemDb,
} from "@cosmicdrift/kumiko-types/tenant-db-types";
import { assertReason } from "../engine/escape-hatch-reason.ts";
import { SYSTEM_TENANT_ID, type TenantId } from "../engine/types/identifiers.ts";
import { AccessDeniedError, InternalError } from "../errors/index.ts";
import { fallbackEscapeHatchReporter } from "../observability/escape-hatch-report.ts";
import type { DbRunner } from "./connection.ts";
import { projectionRegistryOf } from "./projection-registry-binding.ts";
import { unsafeRawScopedRunner } from "./row-level-security-scope.ts";
import { tenantDbRunner } from "./tenant-db-runner.ts";
import {
  boundRunner,
  declaredUnsafeRawRunners,
  hasGrant,
  personalDataGates,
  scopeTenantDbToTenant,
  withoutExecutorManagedWrites,
  withUnsafeRawGrant,
} from "./tenant-db-runner-binding.ts";

const systemDbRebinders = new WeakMap<
  object,
  (grant: EscapeHatchDeclaration | undefined, deniedCallerLabel: string) => UncheckedSystemDb
>();

// Rebinds a hook's own escapeHatch onto ctx.systemDb, mirroring withUnsafeRawGrant: always
// rebuilt from the original db/dbOutsideTransaction/report, never stacked onto a prior rebind.
// Inputs not built by createUncheckedSystemDb pass through unchanged.
export function withSystemDbUnsafeRawGrant<T extends object>(
  systemDb: T,
  grant: EscapeHatchDeclaration | undefined,
  deniedCallerLabel: string,
): T | UncheckedSystemDb {
  const rebind = systemDbRebinders.get(systemDb);
  return rebind ? rebind(grant, deniedCallerLabel) : systemDb;
}

// Ungated when `gate` is absent (the handler's own ctx.systemDb — systemScope() is
// itself the grant there). Gated by a hook's own escapeHatch when `gate.kind` is
// "hook-grant": unsafeRaw then denies without `hasGrant(gate.grant)`, same error shape
// as ctx.db.unsafeRaw's denial in createTenantDb below. Gated by the source TenantDb's
// own escapeHatch when `gate.kind` is "source-tenant-db" (createSystemDbView): unsafeRaw
// defers entirely to db's own declared runner (reason/memberReadOnly/grant check and
// report) — the view's own `report` is never called for unsafe-raw in that mode, and a
// source not built by createTenantDb fails closed.
function buildUncheckedSystemDb(
  db: TenantDb,
  dbOutsideTransaction: TenantDb | undefined,
  report: EscapeHatchReporter,
  gate?:
    | {
        readonly kind: "hook-grant";
        readonly grant: EscapeHatchDeclaration | undefined;
        readonly deniedCallerLabel: string;
      }
    | { readonly kind: "source-tenant-db" },
): UncheckedSystemDb {
  const allowedTenantIds: readonly TenantId[] = [db.tenantId, SYSTEM_TENANT_ID];

  // Fails closed instead of falling back to the in-tx `db` — a silent
  // fallback would defeat the point of a durability write that must survive
  // a rollback of the handler's own transaction. InternalError (not
  // AccessDeniedError) because this is a dispatch wiring fault, not a
  // tenant-access denial — mirrors the "no database connection configured"
  // case in dispatch-shared.ts's appendDomainEvent.
  function requireSystemOutsideTransactionDb(): TenantDb {
    if (!dbOutsideTransaction) {
      throw new InternalError({
        message:
          "systemScope() outsideTransaction check failed: no outside-transaction database " +
          "source is configured for this dispatch.",
      });
    }
    return dbOutsideTransaction;
  }

  function grantedUnsafeRawRunner(reason: string, forwardedDeclaredStep: boolean): DbRunner {
    if (gate?.kind === "source-tenant-db") {
      const sourceRunner = declaredUnsafeRawRunners.get(db);
      if (!sourceRunner) {
        throw new InternalError({
          message:
            "createSystemDbView received a TenantDb with no declared unsafeRaw runner bound.",
        });
      }
      return sourceRunner(forwardedDeclaredStep ? reason : undefined);
    }
    assertReason("ctx.systemDb.unsafeRaw(reason)", reason);
    if (gate && !hasGrant(gate.grant)) {
      throw new AccessDeniedError({
        message:
          'ctx.systemDb.unsafeRaw(reason): rejected — declare `escapeHatch: { reason: "...", grants: ["unsafeRaw"] }` on ' +
          `${gate.deniedCallerLabel} to allow unsafeRaw.`,
      });
    }
    // A granted unsafeRaw is a declared, audited bypass of the TenantDb filter, so row-level security does not narrow it either.
    // Engine-forwarded steps carry their own declared reason; a caller-supplied one never reaches the audit trail.
    report("unsafe-raw", forwardedDeclaredStep ? reason : (gate?.grant?.reason ?? reason));
    const runner = unsafeRawScopedRunner(withoutExecutorManagedWrites(tenantDbRunner(db)));
    return boundRunner(runner, personalDataGates.get(db), projectionRegistryOf(db), false, true);
  }

  const uncheckedSystemDb: UncheckedSystemDb = {
    [SYSTEM_SCOPE_CHECK_BRAND]: true,

    assertTenantMatch(tenantId) {
      if (tenantId !== db.tenantId) {
        throw new AccessDeniedError({
          message: `systemScope() tenant self-check failed: expected "${db.tenantId}", got "${tenantId}"`,
        });
      }
      return db;
    },

    scopedTo(tenantId) {
      if (tenantId !== db.tenantId) {
        throw new AccessDeniedError({
          message: `systemScope() tenant self-check failed: expected "${db.tenantId}", got "${tenantId}"`,
        });
      }
      return scopeTenantDbToTenant(db, tenantId);
    },

    // Fails closed on any mismatch rather than silently dropping rows.
    // Reference rows (tenantId === SYSTEM_TENANT_ID) are allowed, mirroring
    // "tenant"-mode readWhere's own [tenantId, SYSTEM_TENANT_ID] allowlist.
    assertRowsTenant<T>(rows: readonly T[], tenantField: keyof T): readonly T[] {
      const hasOffender = rows.some(
        (row) => !allowedTenantIds.some((allowed) => allowed === row[tenantField]),
      );
      if (hasOffender) {
        throw new AccessDeniedError({
          message: `systemScope() row tenant self-check failed on field "${String(tenantField)}"`,
        });
      }
      return rows;
    },

    acknowledgeCrossTenant(reason) {
      assertReason("acknowledgeCrossTenant(reason)", reason);
      report("acknowledge-cross-tenant", reason);
      return db;
    },

    unsafeRaw: (reason) => grantedUnsafeRawRunner(reason, false),

    outsideTransaction: {
      assertTenantMatch(tenantId) {
        if (tenantId !== db.tenantId) {
          throw new AccessDeniedError({
            message: `systemScope() outsideTransaction tenant self-check failed: expected "${db.tenantId}", got "${tenantId}"`,
          });
        }
        return requireSystemOutsideTransactionDb();
      },

      acknowledgeCrossTenant(reason) {
        assertReason("acknowledgeCrossTenant(reason)", reason);
        const result = requireSystemOutsideTransactionDb();
        report("acknowledge-cross-tenant", reason);
        return result;
      },
    },
  };
  declaredUnsafeRawRunners.set(uncheckedSystemDb, (declaredStepReason) => {
    if (declaredStepReason === undefined) {
      throw new InternalError({
        message: "A declared unsafeRaw runner on a system db requires the step reason.",
      });
    }
    return grantedUnsafeRawRunner(declaredStepReason, true);
  });
  if (gate?.kind !== "source-tenant-db") {
    systemDbRebinders.set(uncheckedSystemDb, (grant, deniedCallerLabel) =>
      buildUncheckedSystemDb(
        withUnsafeRawGrant(db, grant),
        dbOutsideTransaction && withUnsafeRawGrant(dbOutsideTransaction, grant),
        report,
        { kind: "hook-grant", grant, deniedCallerLabel },
      ),
    );
  }
  return uncheckedSystemDb;
}

// Framework-private (not re-exported from db/index.ts): buildHandlerContext
// (pipeline/dispatch-shared.ts) always builds "system" mode from the caller's
// own tenantId, never a foreign one.
//
// dbOutsideTransaction is optional so every existing single-arg call site
// (jobs/job-runner.ts, tests) keeps compiling — those callers have no outside-tx
// source to hand in. Only buildHandlerContext passes it, which is also the only
// place `.outsideTransaction` is reachable through `ctx.systemDb`.
//
// Ungated here (the handler's own systemScope() is the grant); a hook's own
// escapeHatch is layered on afterwards via withSystemDbUnsafeRawGrant. Public
// callers use createSystemDbView instead, whose unsafeRaw follows the source
// TenantDb's own escapeHatch gate.
export function createUncheckedSystemDb(
  db: TenantDb,
  dbOutsideTransaction?: TenantDb,
  report: EscapeHatchReporter = fallbackEscapeHatchReporter(db.tenantId),
): UncheckedSystemDb {
  return buildUncheckedSystemDb(db, dbOutsideTransaction, report);
}

// Public: must never grant more raw access than the source TenantDb — unlike
// createUncheckedSystemDb (framework-private; r.systemScope()/a job IS the
// declaration), this view's unsafeRaw defers entirely to db's own escapeHatch gate.
export function createSystemDbView(
  db: TenantDb,
  dbOutsideTransaction?: TenantDb,
  report: EscapeHatchReporter = fallbackEscapeHatchReporter(db.tenantId),
): UncheckedSystemDb {
  return buildUncheckedSystemDb(db, dbOutsideTransaction, report, { kind: "source-tenant-db" });
}
