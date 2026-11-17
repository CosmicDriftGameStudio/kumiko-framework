import * as z from "zod";

// Shared by the server route and the browser hook; the client validates the anonymous
// response with it instead of casting.
export const DEMO_MODE_PATH = "/demo-mode";

export const demoAccountRoleSchema = z.enum(["admin", "sysadmin"]);
export type DemoAccountRole = z.infer<typeof demoAccountRoleSchema>;

const localizedTextSchema = z.record(z.string(), z.string()).readonly();

export const demoModePayloadSchema = z
  .object({
    readOnly: z.boolean(),
    notice: z
      .object({
        text: localizedTextSchema.optional(),
        links: z
          .array(z.object({ label: localizedTextSchema, href: z.string() }).readonly())
          .readonly()
          .optional(),
        accounts: z
          .array(
            z
              .object({
                role: demoAccountRoleSchema,
                label: localizedTextSchema.optional(),
                email: z.string(),
                password: z.string(),
              })
              .readonly(),
          )
          .readonly(),
      })
      .readonly(),
  })
  .readonly();
export type DemoModePayload = z.infer<typeof demoModePayloadSchema>;
