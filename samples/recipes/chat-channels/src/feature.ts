// Chat Channels Sample
//
// A handler tells the tenant's ops chat about something. Chat targets belong to
// the tenant, not to a user, so the feature addresses one by connection name via
// `route` — it never sees the webhook URL. The tenant stores that URL as a secret
// under `channel-slack:webhooks.<connection name>`.

import {
  defineFeature,
  defineWriteHandler,
  type NotifyFn,
  qn,
} from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";

export const OPS_ANNOUNCEMENT_TYPE = qn("ops", "notify", "announcement");

export const opsFeature = defineFeature("ops", (r) => {
  r.requires("delivery");

  r.writeHandler(
    defineWriteHandler({
      name: "announce",
      schema: z.object({
        connection: z.string(),
        title: z.string().min(1),
        body: z.string().optional(),
      }),
      access: { roles: ["Admin"] },
      handler: async (event, ctx) => {
        const notify = ctx.notify as NotifyFn;
        await notify(OPS_ANNOUNCEMENT_TYPE, {
          route: { slack: event.payload.connection },
          data: { title: event.payload.title, body: event.payload.body },
        });
        return { isSuccess: true, data: { announced: true } };
      },
    }),
  );
});
