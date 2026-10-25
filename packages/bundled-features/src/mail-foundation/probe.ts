import {
  createSystemUser,
  type FeatureRegistrar,
  type ProbeContext,
  ProbeFailure,
  SETTINGS_HUB_FEATURE,
} from "@cosmicdrift/kumiko-framework/engine";
import { UnconfiguredError } from "@cosmicdrift/kumiko-framework/errors";
import { HostResolutionError } from "@cosmicdrift/kumiko-framework/http";
import { createConfigAccessor } from "../config/index.ts";
import { tenantMailTransport } from "./feature.ts";
import { MAIL_PROBE_KEYS } from "./i18n.ts";

const PROBE_SUBJECT = "Kumiko system check";
const PROBE_TEXT = "This message was sent by the system check. No action is needed.";
const MAIL_SETTINGS_SCREEN_QN = `${SETTINGS_HUB_FEATURE}:screen:mail-foundation-tenant`;

// The raw error stays in the server log: it can name hosts, users or the recipient.
function probeFailure(ctx: ProbeContext, error: unknown, key: string): ProbeFailure {
  ctx.obs.log.warn("mail probe failed", {
    error: error instanceof Error ? error.message : String(error),
  });
  return new ProbeFailure({ key });
}

function transportFailureKey(error: unknown): string {
  if (error instanceof HostResolutionError) return MAIL_PROBE_KEYS.hostNotFound;
  return error instanceof UnconfiguredError
    ? MAIL_PROBE_KEYS.setupIncomplete
    : MAIL_PROBE_KEYS.setupFailed;
}

// The mail goes to whoever started the check; the address never appears in the stored result.
export function registerMailProbe(r: FeatureRegistrar<"mail-foundation">): void {
  r.probe({
    name: "send-test-mail",
    scope: "tenant",
    cost: "free",
    area: MAIL_PROBE_KEYS.area,
    label: MAIL_PROBE_KEYS.label,
    fixScreen: MAIL_SETTINGS_SCREEN_QN,
    run: async (ctx) => {
      const { configResolver, secrets } = ctx.services;
      if (!configResolver) {
        return { status: "skipped", message: { key: MAIL_PROBE_KEYS.notConfigured } };
      }
      const config = createConfigAccessor(
        ctx.registry,
        configResolver,
        ctx.tenantId,
        createSystemUser(ctx.tenantId).id,
        ctx.db,
      );
      const transport = await tenantMailTransport({
        tenantId: ctx.tenantId,
        config,
        registry: ctx.registry,
        secrets,
      }).catch((error: unknown) => {
        throw probeFailure(ctx, error, transportFailureKey(error));
      });
      if (transport === null) {
        return { status: "skipped", message: { key: MAIL_PROBE_KEYS.notConfigured } };
      }
      if (ctx.triggeredByEmail === undefined) {
        return { status: "skipped", message: { key: MAIL_PROBE_KEYS.noRecipient } };
      }
      await transport
        .send({
          to: ctx.triggeredByEmail,
          subject: PROBE_SUBJECT,
          text: PROBE_TEXT,
          html: `<p>${PROBE_TEXT}</p>`,
        })
        .catch((error: unknown) => {
          throw probeFailure(ctx, error, MAIL_PROBE_KEYS.sendRejected);
        });
      return { status: "ok", message: { key: MAIL_PROBE_KEYS.accepted } };
    },
  });
}
