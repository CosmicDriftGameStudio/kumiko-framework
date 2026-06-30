// Tenant-Invite Step 1 (create).
//
// Admin invitet email → DB-Row entsteht via event-store-executor (oder
// wird re-used bei Re-Invite), Random-Token in Redis bidirektional, und der
// Handler schickt die Invite-Mail an den Invitee via delivery (ctx.notify) —
// wie reset/verify/signup. Der Token geht NICHT an den Admin zurück (er soll
// die Annahme nicht impersonieren können).
//
// Resend-Idempotenz: Re-Invite für gleiche (tenantId, email) während
// pending → existing row + token re-genutzt + TTL refresh + zweite Mail
// mit GLEICHEM Link. Bei status="cancelled" oder "accepted": existing
// row updated zurück auf status=pending + neuer token.
//
// Always-200 für unbekannten User: bei invitee-Email die nicht in users
// existiert wird trotzdem ein Invite erstellt — Branch-3-Accept-Flow
// erlaubt new-user-signup mit dem Token. Keine Enumeration durchs
// invite-create.

import { generateToken } from "@cosmicdrift/kumiko-framework/api";
import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
// kumiko-lint-ignore cross-feature-import invite-flow lebt in auth-email-password (Magic-Link-Pattern), DB-row-owner ist tenant-feature
import {
  INVITATION_STATUS,
  tenantInvitationEntity,
  tenantInvitationsTable,
} from "../../tenant/invitation-table";
// kumiko-lint-ignore cross-feature-import membership-role validation owned by tenant-feature
import {
  findForbiddenMembershipRole,
  reservedMembershipRoleError,
} from "../../tenant/membership-roles";
import { AUTH_INVITE_DEFAULT_TTL_MINUTES } from "../constants";
import type { AuthMailLocale } from "../email-templates";
import { renderInviteEmail } from "../email-templates";
import { getTokenForInvitation, storeInviteToken } from "../invite-token-store";
import { dispatchMagicLinkMail } from "../magic-link-mail";

const INVITE_NOTIFICATION_TYPE = "auth-email-password:invite";

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
  readonly expiresAt: string;
};

export type InviteCreateOptions = {
  /** TTL für den Activation-Token. Default 7 Tage. */
  readonly tokenTtlMinutes?: number;
  /** App page that receives the magic-link; the handler appends `?token=…`
   *  and dispatches the invite mail via delivery (ctx.notify). */
  readonly appUrl: string;
  readonly appName?: string;
  readonly locale?: AuthMailLocale;
};

const executor = createEventStoreExecutor(tenantInvitationsTable, tenantInvitationEntity, {
  entityName: "tenant-invitation",
});

export function createInviteCreateHandler(opts: InviteCreateOptions) {
  const ttlMinutes = opts.tokenTtlMinutes ?? AUTH_INVITE_DEFAULT_TTL_MINUTES;
  const ttlSeconds = ttlMinutes * 60;

  return defineWriteHandler<"invite-create", typeof InviteCreateSchema, InviteCreateData>({
    name: "invite-create",
    schema: InviteCreateSchema,
    access: { roles: ["Admin"] },
    handler: async (event, ctx) => {
      if (!ctx.redis) {
        return writeFailure(
          new InternalError({ message: "invite-create requires ctx.redis for token store" }),
        );
      }

      const forbiddenRole = findForbiddenMembershipRole([event.payload.role]);
      if (forbiddenRole !== undefined) {
        return writeFailure(reservedMembershipRoleError(forbiddenRole));
      }

      const email = event.payload.email.toLowerCase();
      const tenantId = event.user.tenantId;
      const expiresAt = Temporal.Now.instant().add({ seconds: ttlSeconds });

      // Existing row für (tenantId, email) — unique-index garantiert
      // max. eine Row. Status egal (cancelled/accepted/expired/pending);
      // wir setzen sie auf pending zurück und vergeben einen frischen
      // Token wenn der bisherige nicht mehr lebt.
      const existing = await fetchOne(ctx.db.raw, tenantInvitationsTable, { tenantId, email });

      let invitationId: string;
      let token: string;
      if (existing) {
        invitationId = existing["id"] as string; // @cast-boundary db-row
        const existingVersion = existing["version"] as number; // @cast-boundary db-row
        // Resend-Idempotenz: Token aus Redis re-use wenn noch lebend.
        // Sonst neuen mintinen (alter ist abgelaufen).
        const existingToken = await getTokenForInvitation(ctx.redis, invitationId);
        token = existingToken ?? generateToken();

        const updateResult = await executor.update(
          {
            id: invitationId,
            version: existingVersion,
            changes: {
              role: event.payload.role,
              status: INVITATION_STATUS.pending,
              invitedBy: event.user.id,
              expiresAt,
            },
          },
          event.user,
          ctx.db,
        );
        if (!updateResult.isSuccess) return updateResult;
      } else {
        const createResult = await executor.create(
          {
            email,
            role: event.payload.role,
            status: INVITATION_STATUS.pending,
            invitedBy: event.user.id,
            expiresAt,
          },
          event.user,
          ctx.db,
        );
        if (!createResult.isSuccess) return createResult;
        invitationId = (createResult.data as { id: string }).id; // @cast-boundary engine-payload
        token = generateToken();
      }

      await storeInviteToken(ctx.redis, { invitationId, token, ttlSeconds });

      await dispatchMagicLinkMail(
        ctx.notify,
        {
          handlerName: "invite-create",
          notificationType: INVITE_NOTIFICATION_TYPE,
          renderContent: (renderArgs) =>
            renderInviteEmail({ ...renderArgs, role: event.payload.role }),
        },
        {
          email,
          appUrl: opts.appUrl,
          token,
          expiresAt: expiresAt.toString(),
          ...(opts.appName !== undefined && { appName: opts.appName }),
          ...(opts.locale !== undefined && { locale: opts.locale }),
        },
      );

      return {
        isSuccess: true,
        data: {
          kind: "invite-created",
          invitationId,
          tenantId,
          email,
          role: event.payload.role,
          expiresAt: expiresAt.toString(),
        },
      };
    },
  });
}
