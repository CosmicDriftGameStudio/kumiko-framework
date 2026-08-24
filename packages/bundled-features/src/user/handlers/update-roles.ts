import { asEntityTableMeta, asRawClient, fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  acquireNamespacedAdvisoryLock,
  createEventStoreExecutor,
  type TenantDb,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  findForbiddenRoleAssignment,
  type HandlerContext,
  type SessionUser,
  SYSTEM_TENANT_ID,
  type WriteResult,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  AccessDeniedError,
  ConflictError,
  NotFoundError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { parseRoles } from "@cosmicdrift/kumiko-framework/utils";
import { UserErrors } from "../constants";
import { USER_STATUS, userEntity, userTable } from "../schema/user";

const crud = createEventStoreExecutor(userTable, userEntity, { entityName: "user" });

const REVOKE_ALL_SESSIONS_QN = "sessions:write:user-session:revoke-all-for-user";

// Serializes last-SystemAdmin demotion checks globally inside the write TX
// (dispatcher batch wraps handlers in transaction — xact lock holds through update).
const LAST_SYSTEM_ADMIN_LOCK_NAMESPACE = 0x7361646d; // 'sadm'

type UserRolesRow = {
  id: string;
  roles: string | null;
  status: string | null;
  isDeleted?: boolean;
};

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function isActiveUserRow(row: UserRolesRow): boolean {
  if (row.isDeleted === true) return false;
  return row.status === USER_STATUS.Active || !row.status;
}

function isActiveSystemAdminRow(row: UserRolesRow): boolean {
  return isActiveUserRow(row) && parseRoles(row.roles).includes("SystemAdmin");
}

async function countOtherActiveSystemAdmins(db: TenantDb, excludeUserId: string): Promise<number> {
  const tableName = asEntityTableMeta(userTable)?.tableName ?? "read_users";
  // kumiko-lint-ignore raw-sql LIKE prefilter for SystemAdmin roster under advisory lock
  const rows = (await asRawClient(db.raw).unsafe(
    `SELECT id, roles, status, is_deleted AS "isDeleted"
     FROM ${quoteIdent(tableName)}
     WHERE is_deleted = false
       AND (status = $1 OR status IS NULL)
       AND roles LIKE '%SystemAdmin%'`,
    [USER_STATUS.Active],
  )) as UserRolesRow[];
  return rows.filter((u) => u.id !== excludeUserId && isActiveSystemAdminRow(u)).length;
}

type RolesUpdateEvent = {
  payload: {
    id: string;
    version: number;
    changes: {
      roles: string | string[];
      displayName?: string;
      locale?: string;
      timezone?: string;
      email?: string;
      passwordHash?: string;
      lastActiveTenantId?: string;
      emailVerified?: boolean;
    };
  };
  user: SessionUser;
};

export async function applyUserRolesUpdate(
  event: RolesUpdateEvent,
  ctx: HandlerContext,
  db: TenantDb,
): Promise<WriteResult> {
  const targetUser = await fetchOne<UserRolesRow>(db, userTable, { id: event.payload.id });

  if (!targetUser) {
    return writeFailure(
      new NotFoundError("user", event.payload.id, {
        i18nKey: "user.errors.notFound",
        i18nParams: { id: event.payload.id },
      }),
    );
  }

  const newRoles = parseRoles(event.payload.changes.roles);
  const targetCurrentRoles = parseRoles(targetUser.roles);
  const actorRoles = event.user.roles;

  const forbidden = findForbiddenRoleAssignment(actorRoles, newRoles, targetCurrentRoles);
  if (forbidden !== undefined) {
    return writeFailure(
      new AccessDeniedError({
        message: `role "${forbidden}" cannot be assigned by this actor`,
        i18nKey: "user.errors.roleElevationForbidden",
        details: { reason: UserErrors.roleElevationForbidden, role: forbidden },
      }),
    );
  }

  const wasActiveSystemAdmin =
    isActiveUserRow(targetUser) && targetCurrentRoles.includes("SystemAdmin");
  const willBeSystemAdmin = newRoles.includes("SystemAdmin");

  if (wasActiveSystemAdmin && !willBeSystemAdmin) {
    // Lock before count+update so two concurrent demotions cannot both
    // observe otherActiveSystemAdmins >= 1 and leave zero active SystemAdmins.
    await acquireNamespacedAdvisoryLock(db, LAST_SYSTEM_ADMIN_LOCK_NAMESPACE, "global");
    const otherActiveSystemAdmins = await countOtherActiveSystemAdmins(db, event.payload.id);
    if (otherActiveSystemAdmins === 0) {
      return writeFailure(
        new ConflictError({
          message: "cannot demote the last active SystemAdmin",
          i18nKey: "user.errors.cannotDemoteLastSystemAdmin",
          details: {
            reason: UserErrors.cannotDemoteLastSystemAdmin,
            targetUserId: event.payload.id,
          },
        }),
      );
    }
  }

  const normalizedChanges = {
    ...event.payload.changes,
    roles: JSON.stringify(newRoles),
  };

  // Persist roles first. Session revoke runs only after a successful update so a
  // version conflict / projection error cannot leave sessions revoked while roles
  // stay unchanged. Dispatcher TX still wraps both: revoke shares the write tx
  // and rolls back with a failed outer write.
  const updateResult = await crud.update(
    { ...event.payload, changes: normalizedChanges },
    event.user,
    db,
  );
  if (!updateResult.isSuccess) {
    return updateResult;
  }

  const revoker = ctx.registry.getWriteHandler(REVOKE_ALL_SESSIONS_QN);
  if (revoker) {
    await ctx.writeAs(
      createSystemUser(event.user.tenantId ?? SYSTEM_TENANT_ID),
      REVOKE_ALL_SESSIONS_QN,
      {
        userId: event.payload.id,
      },
    );
  }

  return updateResult;
}
