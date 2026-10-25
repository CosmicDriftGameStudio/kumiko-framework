import { createSystemUser, type FeatureRegistrar } from "@cosmicdrift/kumiko-framework/engine";
import { createConfigAccessor } from "../config/index.ts";
import { tenantMailTransport } from "./feature.ts";
import { MAIL_PROBE_KEYS } from "./i18n.ts";

const PROBE_SUBJECT = "Kumiko system check";
const PROBE_TEXT = "This message was sent by the system check. No action is needed.";

// The mail goes to whoever started the check; the address never appears in the stored result.
export function registerMailProbe(r: FeatureRegistrar<"mail-foundation">): void {
  r.probe({
    name: "send-test-mail",
    scope: "tenant",
    cost: "free",
    area: MAIL_PROBE_KEYS.area,
    label: MAIL_PROBE_KEYS.label,
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
      });
      if (transport === null) {
        return { status: "skipped", message: { key: MAIL_PROBE_KEYS.notConfigured } };
      }
      if (ctx.triggeredByEmail === undefined) {
        return { status: "skipped", message: { key: MAIL_PROBE_KEYS.noRecipient } };
      }
      await transport.send({
        to: ctx.triggeredByEmail,
        subject: PROBE_SUBJECT,
        text: PROBE_TEXT,
        html: `<p>${PROBE_TEXT}</p>`,
      });
      return { status: "ok", message: { key: MAIL_PROBE_KEYS.accepted } };
    },
  });
}
