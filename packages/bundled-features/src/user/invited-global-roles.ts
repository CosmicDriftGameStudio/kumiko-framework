import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  createEventStoreExecutor,
  createTenantDb,
  type DbRunner,
} from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { parseRoles } from "@cosmicdrift/kumiko-framework/utils";
import { GLOBAL_ROLE_OPTIONS } from "./constants.js";
import { userEntity, userTable } from "./schema/user.js";

const userExecutor = createEventStoreExecutor(userTable, userEntity, { entityName: "user" });

type UserRolesRow = {
  readonly id: string;
  readonly version: number;
  readonly roles: readonly string[] | string | null;
};

type GlobalRole = (typeof GLOBAL_ROLE_OPTIONS)[number];

function isGlobalRole(role: string): role is GlobalRole {
  return GLOBAL_ROLE_OPTIONS.some((option) => option === role);
}

// Reads the invitation's stored globalRoles column, keeping only assignable
// global roles — a hand-edited row cannot smuggle "system" into users.roles.
export function parseInvitedGlobalRoles(raw: unknown): readonly GlobalRole[] {
  return parseRoles(raw).filter(isGlobalRole);
}

// Add-only: an accepted invitation never removes a global role the user
// already holds. Users live on SYSTEM_TENANT_ID (tenancy "global").
export async function grantInvitedGlobalRoles(
  db: DbRunner,
  options: { readonly userId: string; readonly globalRoles: readonly string[] },
) {
  const existing = await fetchOne<UserRolesRow>(db, userTable, { id: options.userId });
  if (!existing) return writeFailure(new NotFoundError("user", options.userId));

  const currentRoles = parseRoles(existing.roles);
  const missingRoles = options.globalRoles.filter((role) => !currentRoles.includes(role));
  if (missingRoles.length === 0) return grantedGlobalRoles(currentRoles);

  const roles = [...currentRoles, ...missingRoles];
  const updateResult = await userExecutor.update(
    { id: existing.id, version: existing.version, changes: { roles } },
    createSystemUser(SYSTEM_TENANT_ID),
    createTenantDb(db, SYSTEM_TENANT_ID, "system"),
  );
  if (!updateResult.isSuccess) return updateResult;
  return grantedGlobalRoles(roles);
}

function grantedGlobalRoles(roles: readonly string[]) {
  return { isSuccess: true, data: { roles } } as const;
}
