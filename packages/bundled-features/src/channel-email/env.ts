import * as z from "zod";

/** Env block `createSmtpTransportFromEnv` reads. All optional: without
 *  `SMTP_HOST` no app-level transport is built and auth mail flows stay off. */
export const smtpEnvSchema = z.object({
  SMTP_HOST: z.string().min(1).optional().describe("SMTP host; unset disables app-level mail."),
  SMTP_PORT: z
    .string()
    .regex(/^\d+$/, "must be a port number")
    .optional()
    .describe("SMTP port (default 587)."),
  SMTP_SECURE: z
    .enum(["true", "false"])
    .optional()
    .describe('Implicit TLS ("true") or STARTTLS/plain ("false", default).'),
  SMTP_USER: z.string().min(1).optional().describe("SMTP auth user; auth needs SMTP_PASS too."),
  SMTP_PASS: z
    .string()
    .min(1)
    .optional()
    .describe("SMTP auth password.")
    .meta({ kumiko: { pulumi: { secret: true } } }),
  SMTP_FROM: z
    .string()
    .min(1)
    .optional()
    .describe("Sender address; the app's fallback sender applies when unset."),
});
