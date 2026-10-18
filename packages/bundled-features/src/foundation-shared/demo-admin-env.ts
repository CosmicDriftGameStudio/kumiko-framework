import * as z from "zod";

const SEED_PASSWORD_MIN_LENGTH = 16;

function seedPassword(description: string) {
  return z
    .string()
    .min(SEED_PASSWORD_MIN_LENGTH)
    .optional()
    .describe(`${description} Generate with: openssl rand -hex 24`)
    .meta({ kumiko: { pulumi: { generator: "openssl rand -hex 24", secret: true } } });
}

/** Logins seeded on first boot: the demo tenant admin and the SystemAdmin.
 *  The emails are required so a deploy never seeds an account nobody can
 *  reach; a missing password skips that seed. An app with other rules
 *  overrides single keys by spreading `.shape` before its own fields. */
export const demoAdminEnvSchema = z.object({
  DEMO_ADMIN_EMAIL: z.email().describe("Login of the demo tenant admin seeded on first boot."),
  DEMO_ADMIN_PASSWORD: seedPassword("Password of the seeded demo tenant admin."),
  DEMO_SYSADMIN_EMAIL: z.email().describe("Login of the SystemAdmin seeded on first boot."),
  DEMO_SYSADMIN_PASSWORD: seedPassword("Password of the seeded SystemAdmin."),
  DEMO_TENANT_ID: z.uuid().optional().describe("Id of the seeded demo tenant. Default: generated."),
});
