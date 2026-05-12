import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import {
  complianceProfileOverrideSchema,
  SELECTABLE_PROFILE_KEYS,
} from "@cosmicdrift/kumiko-framework/compliance";
import { createEventStoreExecutor, fetchOne } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  AccessDeniedError,
  UnprocessableError,
  validationErrorFromZod,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "../schema/profile-selection";

const crud = createEventStoreExecutor(tenantComplianceProfileTable, tenantComplianceProfileEntity, {
  entityName: "tenant-compliance-profile",
});

// Schema engt sich auf die 3 oeffentlich waehlbaren Profile (Sprint 1.7
// X1) — minimal-no-region ist Default-Fallback fuer "noch keine Wahl",
// nicht eine waehlbare Production-Option. Symmetrisch zu
// SELECTABLE_PROFILE_KEYS aus der framework/compliance-Liste.
const profileKeySchema = z.enum(SELECTABLE_PROFILE_KEYS);

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
  access: { roles: [ROLES.TenantAdmin, ROLES.SystemAdmin] },
  handler: async (event, ctx) => {
    const tenantOverride = event.payload.tenantIdOverride;
    if (tenantOverride !== undefined && !event.user.roles.includes(ROLES.SystemAdmin)) {
      return writeFailure(
        new AccessDeniedError({
          i18nKey: "complianceProfiles.errors.tenantOverrideRequiresSystemAdmin",
          details: { reason: "tenant_override_requires_system_admin" },
        }),
      );
    }
    const tenantId = (tenantOverride ?? event.user.tenantId) as TenantId;
    const executorUser = tenantOverride !== undefined ? { ...event.user, tenantId } : event.user;

    // Override-Validation: muss parseables JSON-Object sein UND dem
    // ComplianceProfileOverride-Schema entsprechen (S1.9 Z3 — strict-Zod
    // mit Top-Level + Sub-Level-Whitelist via .strict()). Tippfehler
    // wie `{ userRights: { weeks: 3 } }` werden hier rejected statt vom
    // deepMerge silent ins Profile gespliced.
    //
    // Errors via writeFailure + Kumiko-Error-Klassen (S1.10 M3) statt
    // throw — landen so mit Path-Detail im response-body statt als
    // generic internal_error.
    if (event.payload.override) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.payload.override);
      } catch (e: unknown) {
        const parseError = e instanceof Error ? e.message : String(e);
        return writeFailure(
          new UnprocessableError("compliance_override_invalid_json", {
            details: {
              reason: "compliance_override_invalid_json",
              parseError,
            },
          }),
        );
      }
      const validation = complianceProfileOverrideSchema.safeParse(parsed);
      if (!validation.success) {
        return writeFailure(validationErrorFromZod(validation.error));
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
