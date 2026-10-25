import {
  createSystemUser,
  type FeatureRegistrar,
  type ProbeContext,
  ProbeFailure,
} from "@cosmicdrift/kumiko-framework/engine";
import { createConfigAccessor } from "../config/index.ts";
import { type MailAccountRow, toMailAccountRecord } from "./account-record.ts";
import { InboundMailAccountStatuses } from "./constants.ts";
import { INBOUND_PROBE_KEYS } from "./probe-keys.ts";
import { mailAccountsProjectionTable } from "./projection.ts";
import { resolveInboundProviderForAccount } from "./provider-factory.ts";
import { MAIL_ACCOUNT_LIST_SCREEN_QN } from "./screens.ts";
import { type InboundMailContext, isInboundAuthError } from "./types.ts";

const SHORT_ID_LENGTH = 8;

function providerContext(ctx: ProbeContext): InboundMailContext {
  const { configResolver, secrets } = ctx.services;
  const auditUserId = createSystemUser(ctx.tenantId).id;
  return {
    registry: ctx.registry,
    ...(secrets && { secrets }),
    auditUserId,
    ...(configResolver && {
      config: createConfigAccessor(ctx.registry, configResolver, ctx.tenantId, auditUserId, ctx.db),
    }),
  };
}

export function registerMailboxProbe(r: FeatureRegistrar<"inbound-mail-foundation">): void {
  r.probe({
    name: "mailboxes",
    scope: "tenant",
    cost: "free",
    area: INBOUND_PROBE_KEYS.area,
    label: INBOUND_PROBE_KEYS.label,
    fixScreen: MAIL_ACCOUNT_LIST_SCREEN_QN,
    // The address is PII, so the target label carries only the tenant-authored display name.
    targets: async (ctx) => {
      const rows = await ctx.db.selectMany<MailAccountRow>(mailAccountsProjectionTable, {
        status: InboundMailAccountStatuses.active,
      });
      return rows.map((row) => ({
        id: row.id,
        label: {
          key: INBOUND_PROBE_KEYS.mailbox,
          params: { name: row.displayName || row.id.slice(0, SHORT_ID_LENGTH) },
        },
        ...(row.ownerUserId != null && { ownerUserId: row.ownerUserId }),
      }));
    },
    run: async (ctx, target) => {
      const row = target
        ? await ctx.db.fetchOne<MailAccountRow>(mailAccountsProjectionTable, { id: target.id })
        : undefined;
      if (!row) return { status: "skipped", message: { key: INBOUND_PROBE_KEYS.gone } };
      const account = await toMailAccountRecord(row, ctx.tenantId, "inbound-mail-foundation:probe");
      const providerCtx = providerContext(ctx);
      const plugin = resolveInboundProviderForAccount(providerCtx, account);
      try {
        await (plugin.probe ?? plugin.verify)(providerCtx, account);
      } catch (error) {
        if (isInboundAuthError(error)) {
          throw new ProbeFailure({ key: INBOUND_PROBE_KEYS.authFailed });
        }
        throw error;
      }
      return { status: "ok", message: { key: INBOUND_PROBE_KEYS.reachable } };
    },
  });
}
