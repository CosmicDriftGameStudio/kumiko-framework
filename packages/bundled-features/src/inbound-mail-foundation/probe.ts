import {
  configuredPiiSubjectKms,
  decryptPiiFieldValues,
} from "@cosmicdrift/kumiko-framework/crypto";
import {
  createSystemUser,
  type FeatureRegistrar,
  type ProbeContext,
  ProbeFailure,
} from "@cosmicdrift/kumiko-framework/engine";
import { createConfigAccessor } from "../config/index.ts";
import { InboundMailAccountStatuses } from "./constants.ts";
import { MAIL_ACCOUNT_PII_FIELDS } from "./entities.ts";
import { INBOUND_PROBE_KEYS } from "./probe-keys.ts";
import { mailAccountsProjectionTable } from "./projection.ts";
import { resolveInboundProviderForAccount } from "./provider-factory.ts";
import { MAIL_ACCOUNT_LIST_SCREEN_QN } from "./screens.ts";
import { type InboundMailContext, isInboundAuthError, type MailAccountRecord } from "./types.ts";

const SHORT_ID_LENGTH = 8;

type AccountRow = {
  readonly id: string;
  readonly tenantId: string;
  readonly provider: string;
  readonly authMethod: string;
  readonly ownerUserId?: string | null;
  readonly address: string;
  readonly displayName?: string | null;
  readonly watchState?: string | null;
};

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

// Providers never see ciphertext, so the address is decrypted before the call.
async function toAccountRecord(row: AccountRow, tenantId: string): Promise<MailAccountRecord> {
  const piiKms = configuredPiiSubjectKms();
  const decrypted = piiKms
    ? await decryptPiiFieldValues(row, MAIL_ACCOUNT_PII_FIELDS, piiKms, {
        requestId: "inbound-mail-foundation:probe",
      })
    : row;
  const address = decrypted["address"];
  if (typeof address !== "string") throw new Error("mailbox address did not decrypt to text");
  return {
    id: row.id,
    tenantId,
    provider: row.provider,
    authMethod: row.authMethod,
    ownerUserId: row.ownerUserId ?? null,
    address,
    displayName: row.displayName ?? "",
    status: InboundMailAccountStatuses.active,
    watchState: row.watchState ?? "idle",
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
      const rows = await ctx.db.selectMany<AccountRow>(mailAccountsProjectionTable, {
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
        ? await ctx.db.fetchOne<AccountRow>(mailAccountsProjectionTable, { id: target.id })
        : undefined;
      if (!row) return { status: "skipped", message: { key: INBOUND_PROBE_KEYS.gone } };
      const account = await toAccountRecord(row, ctx.tenantId);
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
