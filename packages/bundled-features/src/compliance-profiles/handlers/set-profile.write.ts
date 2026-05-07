import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import {
  SELECTABLE_PROFILE_KEYS,
  type ComplianceProfileKey,
} from "@cosmicdrift/kumiko-framework/compliance";
import { createEventStoreExecutor, fetchOne } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { AccessDeniedError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "../schema/profile-selection";

const crud = createEventStoreExecutor(
  tenantComplianceProfileTable,
  tenantComplianceProfileEntity,
  { entityName: "tenant-compliance-profile" },
);

// Whitelist der erlaubten Top-Level-Keys im Override. Verhindert dass
// Tippfehler ("userrights" statt "userRights") stillschweigend ignoriert
// werden — deepMerge findet den falschen Key nicht und das Override
// hat keine Wirkung. Plus: schützt Identifikations-Felder (key, region,
// label, extends) vor versehentlichem Override das die Profile-
// Identitaet zerstoeren wuerde.
const ALLOWED_OVERRIDE_KEYS: ReadonlySet<string> = new Set([
  "userRights",
  "notifications",
  "breach",
  "auditLog",
  "subProcessor",
  "tenantDestroyGracePeriod",
  "forgetDiscovery",
]);

// Schema engt sich auf die 3 oeffentlich waehlbaren Profile (Sprint 1.7
// X1) — minimal-no-region ist Default-Fallback fuer "noch keine Wahl",
// nicht eine waehlbare Production-Option. Symmetrisch zu
// SELECTABLE_PROFILE_KEYS aus der framework/compliance-Liste.
const profileKeySchema = z.enum(
  SELECTABLE_PROFILE_KEYS as readonly [ComplianceProfileKey, ...ComplianceProfileKey[]],
);

// Tenant-Admin setzt Profile-Key + optional Override-JSON.
//
// Upsert-Verhalten: erste Wahl insert, weitere update. Idempotent —
// wer mit gleichen Werten zweimal aufruft, kriegt das gleiche Ergebnis
// (modulo aktualisierte Audit-Events im Event-Store).
//
// Cross-Tenant-Pfad: SystemAdmin kann via `tenantIdOverride` fuer einen
// anderen Tenant schreiben (Plattform-Operator-Setup, Customer-
// Onboarding-Migrationen). TenantAdmin's Override-Versuch → 403.
// executorUser.tenantId muss = ziel-tenant sein damit der event-store-
// Stream-Lookup nicht miss → version_conflict gibt (Memory:
// feedback_event_store_tenant_consistency).
//
// Validation:
//   - profileKey muss in SELECTABLE_PROFILE_KEYS sein (Zod-checked)
//   - override (optional) muss valides JSON-Object sein
//   - override Top-Level-Keys muessen in ALLOWED_OVERRIDE_KEYS sein
//     — verhindert Tippfehler die deepMerge stillschweigend ignoriert
export const setProfileWrite = defineWriteHandler({
  name: "set-profile",
  schema: z.object({
    profileKey: profileKeySchema,
    override: z.string().nullable().optional(),
    tenantIdOverride: z.string().min(1).optional(),
  }),
  // SystemAdmin kann Profile fuer Customer-Setup setzen (Plattform-
  // Operator-Pfad). TenantAdmin nur fuer eigenen Tenant.
  access: { roles: [ROLES.TenantAdmin, "SystemAdmin"] },
  handler: async (event, ctx) => {
    const tenantOverride = event.payload.tenantIdOverride;
    if (tenantOverride !== undefined && !event.user.roles.includes("SystemAdmin")) {
      return writeFailure(
        new AccessDeniedError({
          i18nKey: "complianceProfiles.errors.tenantOverrideRequiresSystemAdmin",
          details: { reason: "tenant_override_requires_system_admin" },
        }),
      );
    }
    const tenantId = (tenantOverride ?? event.user.tenantId) as TenantId;
    const executorUser =
      tenantOverride !== undefined ? { ...event.user, tenantId } : event.user;

    // Override-Validation: muss parseables JSON-Object sein, mit
    // bekannten Top-Level-Keys.
    if (event.payload.override) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.payload.override);
      } catch (e) {
        throw new Error(
          `Invalid compliance-profile override: ${(e as Error).message}. Expected JSON object string.`,
        );
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("Invalid compliance-profile override: must be a JSON object");
      }
      const unknownKeys = Object.keys(parsed).filter((k) => !ALLOWED_OVERRIDE_KEYS.has(k));
      if (unknownKeys.length > 0) {
        throw new Error(
          `Invalid compliance-profile override: unknown top-level keys [${unknownKeys.join(", ")}]. ` +
            `Allowed: ${[...ALLOWED_OVERRIDE_KEYS].sort().join(", ")}. ` +
            "Tippfehler werden vom deepMerge stillschweigend ignoriert — Schema strict.",
        );
      }
    }

    // Upsert: existierenden Eintrag suchen
    const existing = (await fetchOne(
      ctx.db,
      tenantComplianceProfileTable,
      eq(tenantComplianceProfileTable["tenantId"], tenantId),
    )) as { id: string; version: number } | null;

    if (existing) {
      const result = await crud.update(
        {
          id: existing.id,
          version: existing.version,
          changes: {
            profileKey: event.payload.profileKey,
            override: event.payload.override ?? null,
          },
        },
        executorUser,
        ctx.db,
      );
      if (!result.isSuccess) return result;
      return {
        isSuccess: true as const,
        data: { profileKey: event.payload.profileKey, isNew: false },
      };
    }

    const result = await crud.create(
      {
        profileKey: event.payload.profileKey,
        override: event.payload.override ?? null,
        tenantId,
      },
      executorUser,
      ctx.db,
    );
    if (!result.isSuccess) return result;
    return {
      isSuccess: true as const,
      data: { profileKey: event.payload.profileKey, isNew: true },
    };
  },
});
