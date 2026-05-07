import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { retentionOverrideSchema } from "../override-schema";
import {
  type EffectiveRetentionPolicy,
  type RetentionOverride,
  resolveRetentionPolicy,
} from "../resolver";
import { tenantRetentionOverrideTable } from "../schema/tenant-retention-override";

// retention:query:policy-for — Cross-Feature-API fuer den Forget-Flow.
//
// user-data-rights-Sprint-2.U5 ruft das pro Entity um zu wissen ob ein
// Forget mit "delete" oder "anonymize" oder "blockDelete-bis-Frist"
// laufen soll. Plus Cleanup-Job-Sprint-2.D2b fuer das gleiche.
//
// Tenant-Preset-Storage existiert noch nicht (kommt mit S2.D2b ueber
// einen tenant-config-key). Bis dahin tenantPreset=null — der Resolver
// liefert dann nur die Entity-Default-Layer + Override.
//
// access: openToAll — andere Features im selben Tenant duerfen das
// abrufen. Keine PII im Result, nur Policy-Metadata.
export const policyForQuery = defineQueryHandler({
  name: "policy-for",
  schema: z.object({
    entityName: z.string().min(1).max(100),
  }),
  access: { openToAll: true },
  handler: async (query, ctx): Promise<EffectiveRetentionPolicy> => {
    const entityName = query.payload.entityName;

    // Layer 3: Tenant-Override aus DB laden (UNIQUE(tenantId, entityName))
    const overrideRow = (await fetchOne(
      ctx.db,
      tenantRetentionOverrideTable,
      eq(tenantRetentionOverrideTable["tenantId"], query.user.tenantId),
      eq(tenantRetentionOverrideTable["entityName"], entityName),
    )) as { config: string | null } | null;

    const tenantOverride = parseOverrideOrNull(overrideRow?.config ?? null, query.user.tenantId);

    // Layer 1: Entity-Default aus Registry
    const entityDef = ctx.registry?.getEntity(entityName) ?? null;

    // Layer 2: Tenant-Preset — Storage kommt mit S2.D2b. Bis dahin null.
    const tenantPreset = null;

    return resolveRetentionPolicy({
      entityName,
      entityDef,
      tenantPreset,
      tenantOverride,
    });
  },
});

// Defensiv: ungueltiges JSON aus DB-config wird als "kein Override"
// behandelt + console.warn fuer Operator-Sichtbarkeit. Set-override-
// Handler (S3 ggf.) validiert beim Schreiben gegen retentionOverride-
// Schema; invalides JSON in DB ist also nur via manueller Manipulation
// oder Migration-Bug erreichbar.
function parseOverrideOrNull(raw: string | null, tenantId: string): RetentionOverride | null {
  if (!raw || raw.trim() === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    // biome-ignore lint/suspicious/noConsole: operator visibility for DB-corruption edge-case
    console.warn(
      `[data-retention:policy-for] tenant ${tenantId}: stored override is not valid JSON, ignoring. Reason: ${(e as Error).message}`,
    );
    return null;
  }
  const validation = retentionOverrideSchema.safeParse(parsed);
  if (!validation.success) {
    // biome-ignore lint/suspicious/noConsole: operator visibility for schema-drift
    console.warn(
      `[data-retention:policy-for] tenant ${tenantId}: stored override fails schema validation, ignoring. Issue: ${validation.error.issues[0]?.path.join(".")}: ${validation.error.issues[0]?.message}`,
    );
    return null;
  }
  return validation.data;
}
