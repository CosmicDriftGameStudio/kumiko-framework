// @runtime test
//

// E2E boot: the dev app plus the seedTenant() routes, so specs like
// mfa-login.spec.ts get their own tenant/user instead of the shared admin.
// The inbound-mail route lets a spec put the in-memory mail provider into a failing state
// (the Node-side spec cannot reach the provider's module state) and run the real supervisor poll.
import {
  createInboundMailSupervisor,
  InboundAuthError,
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
  handler: async (c, script) => {
    if (script.kind === "auth-failure-on-next-probe") {
      failNextVerifyWith(script.accountId, new InboundAuthError("e2e: login rejected"));
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
