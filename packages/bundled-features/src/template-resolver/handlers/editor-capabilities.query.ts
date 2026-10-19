import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { emailChannelOf } from "../email-channel.ts";

// Booleans only: like send-test, the caller's address never leaves the server.
export const editorCapabilitiesQuery = defineQueryHandler({
  name: "editor-capabilities",
  schema: z.object({}),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  description:
    "Tells a template editor which actions this app can carry out: fileUploads is true when file storage is wired, so images and file attachments can be uploaded with resourceUpload; testMail is true when an email channel is mounted and resolves the calling user's own address, so send-test can deliver. Returns booleans only, never the address.",
  handler: async (query, ctx) => {
    const channel = emailChannelOf(ctx.registry);
    const address =
      channel === undefined
        ? null
        : ((await channel.resolve?.(query.user.id, {
            db: ctx.db,
            registry: ctx.registry,
            sseBroker: undefined,
            tenantId: query.user.tenantId,
            secrets: ctx.secrets,
            config: ctx.config,
          })) ?? null);
    return {
      // ctx.files exists exactly when file storage is wired, which is also when /api/files is mounted.
      fileUploads: ctx.files !== undefined,
      testMail: address !== null,
    };
  },
});
