import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import { z } from "zod";

export const SEEDABLE_ROLES = [ROLES.TenantAdmin, ROLES.Member] as const;
export const MAX_SEED_MEMBERS = 10;
export const MAX_TENANT_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 320;

export const seedTenantRequestSchema = z.strictObject({
  name: z.string().min(1).max(MAX_TENANT_NAME_LENGTH).optional(),
  members: z.number().int().min(0).max(MAX_SEED_MEMBERS).optional(),
});

export const seededCredentialsSchema = z.object({
  id: z.string(),
  email: z.string(),
  password: z.string(),
});

export const seedTenantResponseSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  admin: seededCredentialsSchema,
  members: z.array(seededCredentialsSchema),
});

function isSystemAdminRole(role: string): boolean {
  return role.trim().toLowerCase() === ROLES.SystemAdmin.toLowerCase();
}

export function resolveSeedableRoles(extraRoles: readonly string[] = []): readonly string[] {
  for (const role of extraRoles) {
    if (typeof role !== "string" || role.trim() === "") {
      throw new Error(
        `createE2eSeedRoutes: extraRoles entries must be non-empty strings, got ${JSON.stringify(role)}`,
      );
    }
    if (isSystemAdminRole(role)) {
      throw new Error(
        `createE2eSeedRoutes: extraRoles must not contain ${ROLES.SystemAdmin}; it is never seedable`,
      );
    }
  }
  return [...new Set<string>([...SEEDABLE_ROLES, ...extraRoles])];
}

export function createSeedUserRequestSchema(extraRoles: readonly string[] = []) {
  const seedable = resolveSeedableRoles(extraRoles);
  return z.strictObject({
    tenantId: z.uuid(),
    roles: z
      .array(
        z.string().refine((role) => seedable.includes(role), {
          message: `not a seedable role; allowed: ${seedable.join(", ")}`,
        }),
      )
      .min(1)
      .max(seedable.length),
  });
}

export const seedUserRequestSchema = createSeedUserRequestSchema();

export const seedUserResponseSchema = seededCredentialsSchema;

export const inboxQuerySchema = z.strictObject({
  tenantId: z.uuid(),
  to: z.string().min(1).max(MAX_EMAIL_LENGTH),
});

const capturedMailSchema = z.object({
  to: z.string(),
  subject: z.string(),
  html: z.string(),
  from: z.string().optional(),
  replyTo: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

export const inboxResponseSchema = z.object({ messages: z.array(capturedMailSchema) });

export type CapturedMail = z.infer<typeof capturedMailSchema>;
export type SeedTenantResponse = z.infer<typeof seedTenantResponseSchema>;
export type SeedUserRequest = z.infer<typeof seedUserRequestSchema>;
