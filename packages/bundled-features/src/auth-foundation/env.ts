import * as z from "zod";

const ADMIN_PASSWORD_MIN_LENGTH = 16;

/** Env block behind `auth.admin` and `auth.mail`: the first admin login and the public app URL
 *  the mail links and the Origin guard derive from. Unset keys leave the matching option to
 *  explicit values; an app spreads `.shape` into its env schema and passes the parsed values on. */
export const authEnvSchema = z.object({
  APP_BASE_URL: z
    .url()
    .optional()
    .describe(
      "Public https URL of the app; auth mail links, the Origin guard and unsubscribe links use it.",
    ),
  AUTH_ADMIN_EMAIL: z
    .email()
    .optional()
    .describe("Login of the admin seeded through `auth.admin`."),
  AUTH_ADMIN_PASSWORD: z
    .string()
    .min(ADMIN_PASSWORD_MIN_LENGTH)
    .optional()
    .describe(
      "Password of the admin seeded through `auth.admin`. Generate with: openssl rand -hex 24",
    )
    .meta({ kumiko: { pulumi: { generator: "openssl rand -hex 24", secret: true } } }),
});
