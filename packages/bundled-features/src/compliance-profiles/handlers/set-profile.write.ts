import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import {
  createEventStoreExecutor,
} from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
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

// Tenant-Admin setzt Profile-Key + optional Override-JSON.
//
// Upsert-Verhalten: erste Wahl insert, weitere update. Idempotent —
// wer mit gleichen Werten zweimal aufruft, kriegt das gleiche Ergebnis
// (modulo aktualisierte Audit-Events im Event-Store).
//
// Validation:
//   - profileKey muss in der enum-Liste sein (Zod-checked)
//   - override muss valides JSON sein
//   - override-Schema wird beim Resolver via deep-merge angewandt;
//     Schema-Konformitaet ist schwach validated (DeepPartial<...> auf
//     TS-Ebene, aber nicht alle Feld-Constraints zur Runtime). Sprint
//     2+ koennte das schaerfen sobald Override-UX existiert.
export const setProfileWrite = defineWriteHandler({
  name: "set-profile",
  schema: z.object({
    profileKey: z.enum(["eu-dsgvo", "swiss-dsg", "de-hr-dsgvo-hgb", "minimal-no-region"]),
    override: z.string().nullable().optional(),
  }),
  access: { roles: [ROLES.TenantAdmin] },
  handler: async (event, ctx) => {
    // Override-Validation: muss parseables JSON-Object sein wenn gesetzt.
    if (event.payload.override) {
      try {
        const parsed = JSON.parse(event.payload.override);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new Error("override must be a JSON object");
        }
      } catch (e) {
        throw new Error(
          `Invalid compliance-profile override: ${(e as Error).message}. Expected JSON object string.`,
        );
      }
    }

    // Upsert: existierenden Eintrag suchen
    const existing = (await fetchOne(
      ctx.db,
      tenantComplianceProfileTable,
      eq(tenantComplianceProfileTable["tenantId"], event.user.tenantId),
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
        event.user,
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
        tenantId: event.user.tenantId,
      },
      event.user,
      ctx.db,
    );
    if (!result.isSuccess) return result;
    return {
      isSuccess: true as const,
      data: { profileKey: event.payload.profileKey, isNew: true },
    };
  },
});
