import {
  complianceProfileOverrideSchema,
  SELECTABLE_PROFILE_KEYS,
} from "@cosmicdrift/kumiko-framework/compliance";
import { createEventStoreExecutor, fetchOne } from "@cosmicdrift/kumiko-framework/db";
import { access, defineWriteHandler, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  UnprocessableError,
  validationErrorFromZod,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { requireForTenant } from "../../shared/index.ts";
import {
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "../schema/profile-selection.ts";

const crud = createEventStoreExecutor(tenantComplianceProfileTable, tenantComplianceProfileEntity, {
  entityName: "tenant-compliance-profile",
});

// The schema is limited to the three publicly selectable profiles.
// `minimal-no-region` is the default fallback while no choice has been
// made yet, not a selectable production option. This mirrors
// SELECTABLE_PROFILE_KEYS from the framework/compliance list.
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
  // SystemAdmin can set profiles for customer setup through the platform-
  // operator path; TenantAdmin can set them only for their own tenant.
  access: { roles: access.admin },
  description:
    "Sets or replaces a tenant's compliance profile key plus an optional JSON override, for onboarding or a later region change; a system admin may target a different tenant through tenantIdOverride.",
  handler: async (event, ctx) => {
    const tenantId = (event.payload.tenantIdOverride ?? event.user.tenantId) as TenantId; // @cast-boundary engine-payload
    const { db, streamTenantId } = requireForTenant(ctx, tenantId);

    // The override must be parseable JSON representing an object and must
    // conform to the ComplianceProfileOverride schema. The strict Zod
    // top-level and nested allowlists reject typos such as
    // `{ userRights: { weeks: 3 } }` instead of silently letting
    // deepMerge splice them into the profile.
    //
    // writeFailure and Kumiko error classes preserve path details in the
    // response body instead of producing a generic internal_error.
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
