import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import {
  COMPLIANCE_PROFILES,
  type ComplianceProfile,
  type ComplianceProfileKey,
  SELECTABLE_PROFILE_KEYS,
} from "@cosmicdrift/kumiko-framework/compliance";
import { z } from "zod";

// Liefert alle waehlbaren Compliance-Profile fuer das Tenant-Onboarding.
// Pure In-Memory-Read der Constants — keine DB-Abfrage. Kein Caching
// noetig (modulo Pre-Boot bereits aufgeloest).
//
// Filtert minimal-no-region raus — das ist Default-Fallback, nicht
// auswählbar (Production soll explizite Wahl treffen).
export const listProfilesQuery = defineQueryHandler({
  name: "list-profiles",
  schema: z.object({}),
  access: { openToAll: true },
  handler: async (): Promise<{ profiles: readonly ComplianceProfileSummary[] }> => {
    return {
      profiles: SELECTABLE_PROFILE_KEYS.map(toSummary),
    };
  },
});

interface ComplianceProfileSummary {
  readonly key: ComplianceProfileKey;
  readonly region: string;
  readonly label: string;
  readonly authorityContact: string;
  readonly languages: readonly string[];
}

function toSummary(key: ComplianceProfileKey): ComplianceProfileSummary {
  const p: ComplianceProfile = COMPLIANCE_PROFILES[key];
  return {
    key: p.key,
    region: p.region,
    label: p.label,
    authorityContact: p.breach.authorityContact,
    languages: p.notifications.languages,
  };
}
