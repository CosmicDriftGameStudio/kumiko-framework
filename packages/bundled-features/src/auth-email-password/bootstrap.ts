// Passwordless, idempotent first-run provisioning: tenants plus invitations
// (optionally carrying global roles such as SystemAdmin). Every write goes
// through the dispatcher as the system user, so hooks, events and jobs fire
// exactly as for any other writer. Nobody gets a role before accepting: the
// invitation row holds membership role + global roles until the invitee
// accepts through the regular invite-accept routes.

import { makeDispatchSystemWrite } from "@cosmicdrift/kumiko-framework/api";
import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import type { Dispatcher } from "@cosmicdrift/kumiko-framework/pipeline";
import { parseRoles } from "@cosmicdrift/kumiko-framework/utils";
import type { Redis } from "ioredis";
// kumiko-lint-ignore cross-feature-import bootstrap provisions tenant + invitation rows owned by the tenant feature
import { TenantHandlers } from "../tenant/constants.js";
// kumiko-lint-ignore cross-feature-import bootstrap provisions tenant + invitation rows owned by the tenant feature
import { INVITATION_STATUS, tenantInvitationsTable } from "../tenant/invitation-table.js";
// kumiko-lint-ignore cross-feature-import bootstrap checks existing memberships
import { tenantMembershipsTable } from "../tenant/membership-table.js";
// kumiko-lint-ignore cross-feature-import bootstrap checks for an existing tenant
import { tenantTable } from "../tenant/schema/tenant.js";
// kumiko-lint-ignore cross-feature-import global-role options are owned by the user feature
import type { GLOBAL_ROLE_OPTIONS } from "../user/constants.js";
// kumiko-lint-ignore cross-feature-import bootstrap skips already activated users
import { userTable } from "../user/schema/user.js";
import { AuthHandlers } from "./constants.js";
import { hasLiveInviteToken } from "./invite-token-store.js";

type GlobalRole = (typeof GLOBAL_ROLE_OPTIONS)[number];

export type BootstrapInvite = {
  readonly email: string;
  /** Membership role in the tenant, validated like a tenant-admin invite
   *  (reserved roles such as SystemAdmin are rejected here). */
  readonly role: string;
};

export type BootstrapSeedDeps = {
  readonly tenantId: TenantId;
  readonly db: DbConnection;
  readonly dispatchSystemWrite: ReturnType<typeof makeDispatchSystemWrite>;
};

export type BootstrapTenant = {
  readonly id: TenantId;
  readonly key: string;
  readonly name: string;
  readonly invites?: readonly BootstrapInvite[];
};

export type BootstrapSystemAdmin = {
  readonly email: string;
  /** Home tenant: login needs a membership, so the SystemAdmin is invited
   *  into this tenant with `role` and receives the global role on accept. */
  readonly tenantId: TenantId;
  readonly role: string;
};

export type BootstrapPlan = {
  readonly tenants: readonly BootstrapTenant[];
  readonly systemAdmins?: readonly BootstrapSystemAdmin[];
  /** Runs for each tenant right after this run created it. An existing
   *  tenant is never seeded again — also not when a previous run failed
   *  inside the seed (that run fails; clean up by hand). */
  readonly seed?: (deps: BootstrapSeedDeps) => Promise<void>;
};

export type BootstrapDeps = {
  readonly db: DbConnection;
  readonly redis: Redis;
  readonly dispatcher: Dispatcher;
};

export type BootstrapTenantOutcome = "created" | "exists";

export type BootstrapInviteOutcome =
  // fresh invitation mailed
  | "invited"
  // the previous invitation expired unused, a new link was mailed
  | "resent"
  // a still-valid invitation is pending, nothing sent
  | "pending"
  // the invitee accepted earlier or already holds the access
  | "active"
  // a tenant admin cancelled the invitation; bootstrap respects that
  | "cancelled"
  // a tenant admin re-invited the address without the planned global roles;
  // bootstrap does not override that, the operator has to decide
  | "role-mismatch";

export type BootstrapReport = {
  readonly tenants: ReadonlyArray<{
    readonly id: TenantId;
    readonly outcome: BootstrapTenantOutcome;
    readonly seeded: boolean;
  }>;
  readonly invites: ReadonlyArray<{
    readonly tenantId: TenantId;
    readonly email: string;
    readonly globalRoles: readonly GlobalRole[];
    readonly outcome: BootstrapInviteOutcome;
  }>;
};

type PlannedInvite = {
  readonly tenantId: TenantId;
  readonly email: string;
  readonly role: string;
  readonly globalRoles: readonly GlobalRole[];
};

type InvitationRow = {
  readonly id: string;
  readonly status: string;
  readonly globalRoles: unknown;
};
type UserRow = { readonly id: string; readonly roles: unknown };

export class BootstrapPlanError extends Error {}

export class BootstrapWriteError extends Error {}

function planInvites(plan: BootstrapPlan): readonly PlannedInvite[] {
  const tenantIds = new Set(plan.tenants.map((t) => t.id));
  const invites: PlannedInvite[] = [];
  for (const admin of plan.systemAdmins ?? []) {
    if (!tenantIds.has(admin.tenantId)) {
      throw new BootstrapPlanError(
        `systemAdmins: ${admin.email} references tenant ${admin.tenantId}, which is not in tenants`,
      );
    }
    invites.push({
      tenantId: admin.tenantId,
      email: admin.email.toLowerCase(),
      role: admin.role,
      globalRoles: ["SystemAdmin"],
    });
  }
  for (const tenant of plan.tenants) {
    for (const invite of tenant.invites ?? []) {
      invites.push({
        tenantId: tenant.id,
        email: invite.email.toLowerCase(),
        role: invite.role,
        globalRoles: [],
      });
    }
  }
  // One invitation row per (tenant, email): a second entry would overwrite
  // the first one's role or global roles.
  const seen = new Set<string>();
  for (const invite of invites) {
    const key = `${invite.tenantId}\u0000${invite.email}`;
    if (seen.has(key)) {
      throw new BootstrapPlanError(
        `${invite.email} is listed twice for tenant ${invite.tenantId} (systemAdmins and tenants[].invites share one invitation per tenant)`,
      );
    }
    seen.add(key);
  }
  return invites;
}

async function ensureTenant(
  deps: BootstrapDeps,
  tenant: BootstrapTenant,
): Promise<BootstrapTenantOutcome> {
  const existing = await fetchOne(deps.db, tenantTable, { id: tenant.id });
  if (existing) return "exists";
  const result = await deps.dispatcher.write(
    TenantHandlers.create,
    { id: tenant.id, key: tenant.key, name: tenant.name },
    createSystemUser(tenant.id),
  );
  if (!result.isSuccess) {
    throw new BootstrapWriteError(
      `creating tenant ${tenant.key} (${tenant.id}) failed: ${result.error.code} — ${result.error.message}`,
    );
  }
  return "created";
}

async function holdsInvitedAccess(deps: BootstrapDeps, invite: PlannedInvite): Promise<boolean> {
  const user = await fetchOne<UserRow>(deps.db, userTable, {
    email: invite.email,
    isDeleted: false,
  });
  if (!user) return false;
  const membership = await fetchOne(deps.db, tenantMembershipsTable, {
    userId: user.id,
    tenantId: invite.tenantId,
  });
  if (!membership) return false;
  const userGlobalRoles = parseRoles(user.roles);
  return invite.globalRoles.every((role) => userGlobalRoles.includes(role));
}

async function decideInvite(
  deps: BootstrapDeps,
  invite: PlannedInvite,
): Promise<BootstrapInviteOutcome> {
  if (await holdsInvitedAccess(deps, invite)) return "active";
  const invitation = await fetchOne<InvitationRow>(deps.db, tenantInvitationsTable, {
    tenantId: invite.tenantId,
    email: invite.email,
  });
  if (!invitation) return "invited";
  if (invitation.status === INVITATION_STATUS.cancelled) return "cancelled";
  const storedGlobalRoles = parseRoles(invitation.globalRoles);
  if (!invite.globalRoles.every((role) => storedGlobalRoles.includes(role))) {
    return "role-mismatch";
  }
  if (invitation.status === INVITATION_STATUS.accepted) return "active";
  if (await hasLiveInviteToken(deps.redis, invitation.id)) return "pending";
  return "resent";
}

function isMailingOutcome(outcome: BootstrapInviteOutcome): boolean {
  return outcome === "invited" || outcome === "resent";
}

export async function bootstrapTenants(
  deps: BootstrapDeps,
  plan: BootstrapPlan,
): Promise<BootstrapReport> {
  const plannedInvites = planInvites(plan);
  const dispatchSystemWrite = makeDispatchSystemWrite(deps.dispatcher);

  const tenants: Array<BootstrapReport["tenants"][number]> = [];
  for (const tenant of plan.tenants) {
    const outcome = await ensureTenant(deps, tenant);
    const shouldSeed = outcome === "created" && plan.seed !== undefined;
    if (shouldSeed) {
      await plan.seed?.({ tenantId: tenant.id, db: deps.db, dispatchSystemWrite });
    }
    tenants.push({ id: tenant.id, outcome, seeded: shouldSeed });
  }

  const invites: Array<BootstrapReport["invites"][number]> = [];
  for (const invite of plannedInvites) {
    const outcome = await decideInvite(deps, invite);
    if (isMailingOutcome(outcome)) {
      const result = await deps.dispatcher.write(
        AuthHandlers.systemInviteCreate,
        { email: invite.email, role: invite.role, globalRoles: invite.globalRoles },
        createSystemUser(invite.tenantId),
      );
      if (!result.isSuccess) {
        throw new BootstrapWriteError(
          `inviting ${invite.email} into tenant ${invite.tenantId} failed: ${result.error.code} — ${result.error.message}`,
        );
      }
    }
    invites.push({
      tenantId: invite.tenantId,
      email: invite.email,
      globalRoles: invite.globalRoles,
      outcome,
    });
  }

  return { tenants, invites };
}
