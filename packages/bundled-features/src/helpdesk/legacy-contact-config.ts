import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import {
  ConfigScopes,
  createSystemUser,
  type JobContext,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { ConfigHandlers, configValuesTable } from "../config/index.ts";
import { HELPDESK_FEATURE } from "./web/constants.ts";

export const LEGACY_CONTACT_CONFIG_JOB = "legacy-contact-config";

// The two keys of the former contact feature; the config values stay under them after the rename.
const CARRIED_OVER_KEYS: ReadonlyArray<{ readonly legacy: string; readonly current: string }> = [
  { legacy: "contact:config:reply-to", current: `${HELPDESK_FEATURE}:config:reply-to` },
  { legacy: "contact:config:telegram-chat", current: `${HELPDESK_FEATURE}:config:telegram-chat` },
];

const storedValueSchema = z.union([z.string(), z.number(), z.boolean()]);

// Both keys are system-scope, so the former feature only ever stored system rows.
// Writes through config:write:set, so the helpdesk key's own validation applies.
export async function carryOverLegacyContactConfig(ctx: JobContext): Promise<number> {
  const reads = ctx.crossTenantReads;
  if (!reads) {
    throw new InternalError({
      message: "[helpdesk] legacy-contact-config needs the crossTenantReads grant",
    });
  }
  const systemAdmin = createSystemUser(SYSTEM_TENANT_ID, [ROLES.SystemAdmin]);
  let carriedOver = 0;
  for (const { legacy, current } of CARRIED_OVER_KEYS) {
    // skip: telegramChat is only registered with option telegram, then there is nothing to carry into
    if (!ctx.registry.getConfigKey(current)) continue;
    const alreadySet = await reads.selectMany(configValuesTable, {
      key: current,
      tenantId: SYSTEM_TENANT_ID,
    });
    if (alreadySet.some((row) => row["userId"] == null)) continue;
    const former = await reads.selectMany(configValuesTable, {
      key: legacy,
      tenantId: SYSTEM_TENANT_ID,
    });
    const row = former.find((candidate) => candidate["userId"] == null);
    const stored = typeof row?.["value"] === "string" ? row["value"] : undefined;
    if (stored === undefined) continue;
    const value = storedValueSchema.safeParse(JSON.parse(stored));
    if (!value.success) continue;
    const written = await ctx.dispatch.writeAs(systemAdmin, ConfigHandlers.set, {
      key: current,
      value: value.data,
      scope: ConfigScopes.system,
    });
    if (!written.isSuccess) throw written.error;
    carriedOver++;
  }
  return carriedOver;
}
