// @runtime test
//

// E2E boot: the dev app plus the seedTenant() routes, so specs like
// mfa-login.spec.ts get their own tenant/user instead of the shared admin.
// The inbound-mail route lets a spec put the in-memory mail provider into a failing state
// (the Node-side spec cannot reach the provider's module state), run the real supervisor poll, or
// set a supervisor-owned account status through the real handler as the system identity.
import {
  createInboundMailSupervisor,
  InboundAuthError,
  InboundMailAccountStatuses,
  InboundMailFoundationHandlers,
  type InboundMailSupervisor,
} from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation";
import {
  failNextVerifyWith,
  seedRejectedInboundMessage,
} from "@cosmicdrift/kumiko-bundled-features/inbound-provider-inmemory";
import { runDevApp } from "@cosmicdrift/kumiko-dev-server";
import { createE2eSeedRoutes } from "@cosmicdrift/kumiko-dev-server/testing";
import { ExtraRouteRejection, signatureRoute } from "@cosmicdrift/kumiko-framework/api";
import { isSeedModeEnabled } from "@cosmicdrift/kumiko-framework/event-store";
import type * as z from "zod";
import { devAppOptions } from "../src/app/dev-app-options";
import { INBOUND_MAIL_E2E_ROUTE, inboundMailScriptSchema } from "./_helpers/inbound-mail-script";

let supervisor: InboundMailSupervisor | undefined;

const inboundMailScriptRoute = signatureRoute<z.infer<typeof inboundMailScriptSchema>>({
  method: "POST",
  path: INBOUND_MAIL_E2E_ROUTE,
  entry: "signature",
  verify: async (request) => {
    if (!isSeedModeEnabled()) throw new ExtraRouteRejection(404, { error: "Not Found" });
    const parsed = inboundMailScriptSchema.safeParse(JSON.parse(request.rawBody));
    if (!parsed.success) throw new ExtraRouteRejection(400, { error: parsed.error.message });
    return parsed.data;
  },
  handler: async (c, script, deps) => {
    if (script.kind === "auth-failure-on-next-probe") {
      failNextVerifyWith(script.accountId, new InboundAuthError("e2e: login rejected"));
    } else if (script.kind === "mark-auth-error") {
      // The status is a supervisor signal that only the system identity may set; the IMAP mailbox
      // has no reachable server here to fail a real login against.
      const marked = await deps.dispatchSystemWrite({
        handlerQn: InboundMailFoundationHandlers.updateAccount,
        tenantId: script.tenantId,
        payload: { accountId: script.accountId, status: InboundMailAccountStatuses.authError },
      });
      if (!marked.isSuccess) return c.json({ ok: false, error: marked.error }, 500);
    } else {
      seedRejectedInboundMessage(script.accountId, script.providerMessageId);
      await supervisor?.pollOnce();
    }
    return c.json({ ok: true });
  },
});

await runDevApp({
  ...devAppOptions,
  extraRoutes: [...createE2eSeedRoutes(), inboundMailScriptRoute],
  wire: (deps) => {
    supervisor = createInboundMailSupervisor({
      providerCtx: { registry: deps.registry },
      db: deps.db,
      dispatchWrite: deps.dispatchSystemWrite,
    });
  },
});
