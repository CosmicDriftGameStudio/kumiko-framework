// Tenant-Invite Step 1 (create).
//
// Admin invitet email → DB-Row entsteht via event-store-executor (oder
// wird re-used bei Re-Invite), Random-Token in Redis bidirektional, und der
// Handler schickt die Invite-Mail an den Invitee via delivery (ctx.notify) —
// wie reset/verify/signup. Der Token geht NICHT an den Admin zurück (er soll
// die Annahme nicht impersonieren können).
//
// Re-invite for the same (tenantId, email): the existing row is reused
// regardless of its prior status (pending/cancelled/accepted), reset to
// status=pending, and a fresh token is minted every time — any token
// still live for that invitation is invalidated first, so the previous
// mail's link stops working (see invite-token-store.ts).
//
// Always-200 für unbekannten User: bei invitee-Email die nicht in users
// existiert wird trotzdem ein Invite erstellt — Branch-3-Accept-Flow
// erlaubt new-user-signup mit dem Token. Keine Enumeration durchs
// invite-create.

import { generateToken } from "@cosmicdrift/kumiko-framework/api";
import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  assignableAppRolesOf,
  defineWriteHandler,
  type HandlerContext,
  type SessionUser,
  type WriteResult,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  InternalError,
  type WriteFailure,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
// kumiko-lint-ignore cross-feature-import invite-flow lebt in auth-email-password (Magic-Link-Pattern), DB-row-owner ist tenant-feature
import {
  INVITATION_STATUS,
  tenantInvitationEntity,
  tenantInvitationsTable,
} from "../../tenant/invitation-table.js";
// kumiko-lint-ignore cross-feature-import membership rows are owned by the tenant feature
import { tenantMembershipsTable } from "../../tenant/membership-table.js";
// kumiko-lint-ignore cross-feature-import membership-role validation owned by tenant-feature
import {
  findForbiddenMembershipRole,
  findForbiddenRoleAssignment,
  reservedMembershipRoleError,
  unassignableMembershipRoleError,
} from "../../tenant/membership-roles.js";
// kumiko-lint-ignore cross-feature-import global-role options are owned by the user feature
import { GLOBAL_ROLE_OPTIONS } from "../../user/constants.js";
// kumiko-lint-ignore cross-feature-import invitee lookup by email reads the user row
import { userTable } from "../../user/schema/user.js";
import { AUTH_INVITE_DEFAULT_TTL_MINUTES } from "../constants.js";
import type { AuthMailLocale } from "../email-templates.js";
import { renderInviteEmail } from "../email-templates.js";
import { inviteAlreadyAccepted } from "../errors.js";
import { invalidateExistingInviteToken, storeInviteToken } from "../invite-token-store.js";
import { dispatchMagicLinkMail, resolveHandlerMailLocale } from "../magic-link-mail.js";

const INVITE_NOTIFICATION_TYPE = "auth-email-password:invite";

type GlobalRole = (typeof GLOBAL_ROLE_OPTIONS)[number];

const InviteCreateSchema = z.object({
  email: z.email(),
  role: z.string().min(1).max(50),
});

export type InviteCreateData = {
  readonly kind: "invite-created";
  readonly invitationId: string;
  readonly tenantId: string;
  readonly email: string;
  readonly role: string;
  readonly globalRoles: readonly GlobalRole[];
  readonly expiresAt: string;
};

export type InviteCreateOptions = {
  /** TTL für den Activation-Token. Default 7 Tage. */
  readonly tokenTtlMinutes?: number;
  /** App page that receives the magic-link; the handler appends `?token=…`
   *  and dispatches the invite mail via delivery (ctx.notify). Apps with
   *  language-in-path routing pass a function to pick the right page for
   *  the resolved locale; everyone else keeps a plain string. */
  readonly appUrl: string | ((locale: string) => string);
  readonly appName?: string;
  /** Static fallback mail locale, used only when the request itself
   *  carries no locale signal (no X-Locale header, no usable
   *  Accept-Language) — see the locale resolution in the handler below. */
  readonly locale?: AuthMailLocale;
  // Optional app policy on top of the default elevation guard
  // (findForbiddenRoleAssignment). Cannot authorize reserved or unranked
  // roles, and cannot raise above the inviter's max framework rank — only
  // further restrict assignable ranked roles.
  readonly canAssignRole?: (inviterRoles: readonly string[], targetRole: string) => boolean;
  /** Opt-in allow-list for app-defined (unranked) roles the elevation guard
   *  would otherwise reject with unassignable_membership_role (fw#2398).
   *  Rank-aware alternative: declare roles via EXT_ASSIGNABLE_ROLE. */
  readonly additionalAssignableRoles?: readonly string[];
};

const executor = createEventStoreExecutor(tenantInvitationsTable, tenantInvitationEntity, {
  entityName: "tenant-invitation",
});

// A framework-ranked role is one the highest actor ("system") may assign without the
// unknown-role fail-closed rejection; allow-listing it would let a lower-ranked inviter
// bypass the elevation guard for it.
function findRankedRole(roles: readonly string[]): string | undefined {
  return roles.find((role) => findForbiddenRoleAssignment(["system"], [role], []) === undefined);
}

type InviteIssueRequest = {
  readonly email: string;
  readonly role: string;
  readonly globalRoles: readonly GlobalRole[];
};

function checkAssignableInviteRole(
  opts: InviteCreateOptions,
  inviterRoles: readonly string[],
  role: string,
  ctx: HandlerContext,
): WriteFailure | undefined {
  const forbiddenRole = findForbiddenMembershipRole([role]);
  if (forbiddenRole !== undefined) return writeFailure(reservedMembershipRoleError(forbiddenRole));

  const elevationForbidden = findForbiddenRoleAssignment(
    inviterRoles,
    [role],
    [],
    assignableAppRolesOf(ctx.registry),
  );
  if (
    elevationForbidden !== undefined &&
    !opts.additionalAssignableRoles?.includes(elevationForbidden)
  ) {
    return writeFailure(unassignableMembershipRoleError(elevationForbidden));
  }

  if (opts.canAssignRole && !opts.canAssignRole(inviterRoles, role)) {
    return writeFailure(unassignableMembershipRoleError(role));
  }
  return undefined;
}

// 0 = the invitee has no membership in the tenant yet (or no account at all).
async function currentMembershipVersion(
  ctx: HandlerContext,
  tenantId: string,
  email: string,
): Promise<number> {
  const user = await ctx.db.global(userTable).fetchOne<{ readonly id: string }>({
    email,
    isDeleted: false,
  });
  if (!user) return 0;
  const membership = await ctx.db.fetchOne(tenantMembershipsTable, { tenantId, userId: user.id });
  return membership ? (membership["version"] as number) : 0; // @cast-boundary db-row
}

async function issueInvitation(
  opts: InviteCreateOptions,
  ttlSeconds: number,
  request: InviteIssueRequest,
  inviter: SessionUser,
  ctx: HandlerContext,
  refuseAccepted = false,
): Promise<WriteResult<InviteCreateData>> {
  if (!ctx.redis) {
    return writeFailure(
      new InternalError({ message: "invite-create requires ctx.redis for token store" }),
    );
  }

  const email = request.email.toLowerCase();
  const tenantId = inviter.tenantId;
  const issuedAt = Temporal.Now.instant();
  const expiresAt = issuedAt.add({ seconds: ttlSeconds });

  // The unique index allows one row per (tenantId, email). Whatever its
  // status, a re-invite resets it to pending with a fresh token.
  const existing = await ctx.db.fetchOne(tenantInvitationsTable, { tenantId, email });
  const membershipVersion = await currentMembershipVersion(ctx, tenantId, email);

  let invitationId: string;
  if (existing) {
    // Provisioning callers (waitlist) must not flip an accepted invite back to
    // pending: that would let them cancel a live membership's invitation.
    // The tenant-admin path keeps resetting because re-inviting a member is
    // how roles get re-assigned.
    if (refuseAccepted && existing["status"] === INVITATION_STATUS.accepted) {
      return inviteAlreadyAccepted();
    }
    invitationId = existing["id"] as string; // @cast-boundary db-row
    const existingVersion = existing["version"] as number; // @cast-boundary db-row
    // At most one live invite token per invitation: invalidate
    // whatever's there before minting the new one.
    await invalidateExistingInviteToken(ctx.redis, invitationId);

    const updateResult = await executor.update(
      {
        id: invitationId,
        version: existingVersion,
        changes: {
          role: request.role,
          // Always written, also as []: a tenant-admin resend must drop
          // global roles a previous system invite put on this row.
          globalRoles: [...request.globalRoles],
          status: INVITATION_STATUS.pending,
          invitedBy: inviter.id,
          membershipVersion,
          expiresAt,
        },
      },
      inviter,
      ctx.db,
    );
    if (!updateResult.isSuccess) return updateResult;
  } else {
    const createResult = await executor.create(
      {
        email,
        role: request.role,
        globalRoles: [...request.globalRoles],
        status: INVITATION_STATUS.pending,
        invitedBy: inviter.id,
        membershipVersion,
        expiresAt,
      },
      inviter,
      ctx.db,
    );
    if (!createResult.isSuccess) return createResult;
    invitationId = (createResult.data as { id: string }).id; // @cast-boundary engine-payload
  }

  const token = generateToken();
  await storeInviteToken(ctx.redis, { invitationId, token, ttlSeconds });

  const locale = resolveHandlerMailLocale(ctx, opts.locale);

  await dispatchMagicLinkMail(
    ctx.notify,
    {
      handlerName: "invite-create",
      notificationType: INVITE_NOTIFICATION_TYPE,
      renderContent: (renderArgs) => renderInviteEmail({ ...renderArgs, role: request.role }),
    },
    {
      email,
      appUrl: opts.appUrl,
      token,
      expiresAt: expiresAt.toString(),
      issuedAt: issuedAt.toString(),
      timeZone: ctx.tz.user,
      ...(opts.appName !== undefined && { appName: opts.appName }),
      locale,
    },
  );

  return {
    isSuccess: true,
    data: {
      kind: "invite-created",
      invitationId,
      tenantId,
      email,
      role: request.role,
      globalRoles: request.globalRoles,
      expiresAt: expiresAt.toString(),
    },
  };
}

function assertAppDefinedAdditionalRoles(opts: InviteCreateOptions): void {
  const rankedRole = findRankedRole(opts.additionalAssignableRoles ?? []);
  if (rankedRole !== undefined) {
    throw new Error(
      `[auth-email-password] invite.additionalAssignableRoles must list app-defined roles only; "${rankedRole}" is a framework-ranked role`,
    );
  }
}

export function createInviteCreateHandler(opts: InviteCreateOptions) {
  assertAppDefinedAdditionalRoles(opts);
  const ttlSeconds = (opts.tokenTtlMinutes ?? AUTH_INVITE_DEFAULT_TTL_MINUTES) * 60;

  return defineWriteHandler<"invite-create", typeof InviteCreateSchema, InviteCreateData>({
    name: "invite-create",
    schema: InviteCreateSchema,
    access: { roles: access.admin },
    description:
      "Invites an email address into the caller's tenant with a chosen membership role, creating or reusing the invitation and mailing the invitee a fresh accept link; re-inviting the same address invalidates the previous link.",
    handler: async (event, ctx) => {
      const roleRejection = checkAssignableInviteRole(
        opts,
        event.user.roles,
        event.payload.role,
        ctx,
      );
      if (roleRejection) return roleRejection;
      return issueInvitation(
        opts,
        ttlSeconds,
        { email: event.payload.email, role: event.payload.role, globalRoles: [] },
        event.user,
        ctx,
      );
    },
  });
}

const SystemInviteCreateSchema = z.object({
  email: z.email(),
  role: z.string().min(1).max(50),
  globalRoles: z.array(z.enum(GLOBAL_ROLE_OPTIONS)).max(GLOBAL_ROLE_OPTIONS.length).default([]),
});

// System-only sibling of invite-create: the only path that can put global
// roles (SystemAdmin) on an invitation. No session mint path yields the
// "system" role (users.roles only accepts GLOBAL_ROLE_OPTIONS), so only
// in-process callers dispatching as createSystemUser (runBootstrap) get here.
export function createSystemInviteCreateHandler(opts: InviteCreateOptions) {
  assertAppDefinedAdditionalRoles(opts);
  const ttlSeconds = (opts.tokenTtlMinutes ?? AUTH_INVITE_DEFAULT_TTL_MINUTES) * 60;

  return defineWriteHandler<
    "system-invite-create",
    typeof SystemInviteCreateSchema,
    InviteCreateData
  >({
    name: "system-invite-create",
    schema: SystemInviteCreateSchema,
    access: { roles: access.system },
    agent: { expose: false },
    description:
      "System-only invite into the dispatching tenant that may additionally carry global roles, which the invitee receives only when accepting; used by provisioning such as runBootstrap.",
    handler: async (event, ctx) => {
      const roleRejection = checkAssignableInviteRole(
        opts,
        event.user.roles,
        event.payload.role,
        ctx,
      );
      if (roleRejection) return roleRejection;
      return issueInvitation(opts, ttlSeconds, event.payload, event.user, ctx, true);
    },
  });
}
