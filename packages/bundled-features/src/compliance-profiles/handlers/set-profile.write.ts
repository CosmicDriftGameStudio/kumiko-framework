import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  complianceProfileOverrideSchema,
  SELECTABLE_PROFILE_KEYS,
} from "@cosmicdrift/kumiko-framework/compliance";
import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { access, defineWriteHandler, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  UnprocessableError,
  validationErrorFromZod,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { requireForTenant } from "../../shared/index.js";
import {
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "../schema/profile-selection.js";

const crud = createEventStoreExecutor(tenantComplianceProfileTable, tenantComplianceProfileEntity, {
  entityName: "tenant-compliance-profile",
});

// Schema engt sich auf die 3 oeffentlich waehlbaren Profile (Sprint 1.7
// X1) — minimal-no-region ist Default-Fallback fuer "noch keine Wahl",
// nicht eine waehlbare Production-Option. Symmetrisch zu
// SELECTABLE_PROFILE_KEYS aus der framework/compliance-Liste.
const profileKeySchema = z.enum(SELECTABLE_PROFILE_KEYS);

// Upsert: the first call inserts, later calls update, so repeating the same values
// is idempotent apart from the extra audit events.
//
// A SystemAdmin may target another tenant via `tenantIdOverride` (operator setup,
// onboarding migrations); the dispatcher rejects the override for anyone else. The
// executor then writes into the target tenant's stream via streamTenantId while
// the operator stays the recorded actor.
//
// Override top-level keys are restricted to ALLOWED_OVERRIDE_KEYS because deepMerge
// would silently ignore a typo.
export const setProfileWrite = defineWriteHandler({
  name: "set-profile",
  schema: z.object({
    profileKey: profileKeySchema,
    override: z.string().nullable().optional(),
    tenantIdOverride: z.string().min(1).optional(),
  }),
  // SystemAdmin kann Profile fuer Customer-Setup setzen (Plattform-
  // Operator-Pfad). TenantAdmin nur fuer eigenen Tenant.
  access: { roles: access.admin },
  description:
    "Sets or replaces a tenant's compliance profile key plus an optional JSON override, for onboarding or a later region change; a system admin may target a different tenant through tenantIdOverride.",
  handler: async (event, ctx) => {
    const tenantId = (event.payload.tenantIdOverride ?? event.user.tenantId) as TenantId; // @cast-boundary engine-payload
    const { db, streamTenantId } = requireForTenant(ctx, tenantId);

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
            details: { parseError },
          }),
        );
      }
      const validation = complianceProfileOverrideSchema.safeParse(parsed);
      if (!validation.success) {
        return writeFailure(validationErrorFromZod(validation.error));
      }
    }

    // Upsert: existierenden Eintrag suchen
    const existing = (await fetchOne(db, tenantComplianceProfileTable, {
      tenantId: tenantId,
    })) as { id: string; version: number } | null; // @cast-boundary db-runner

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
        event.user,
        db,
        { streamTenantId },
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
      event.user,
      db,
      { streamTenantId },
    );
    if (!result.isSuccess) return result;
    return {
      isSuccess: true as const,
      data: { profileKey: event.payload.profileKey, isNew: true },
    };
  },
});
