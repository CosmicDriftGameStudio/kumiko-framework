import {
  getActiveSubProcessors,
  getPlannedSubProcessors,
  KUMIKO_SUB_PROCESSORS,
  type SubProcessor,
} from "@cosmicdrift/kumiko-framework/compliance";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

// Public Sub-Processor-Liste — anonymous accessible (Memory:
// project_anonymous_access). Matched die DSGVO Art. 28(2) Pflicht
// dass die Liste der Auftragsverarbeiter oeffentlich einsehbar ist
// (typisch verlinkt aus Datenschutzerklaerung + AVV).
//
// Format: JSON mit getrennten active/planned-Sektionen. Tenant-Admins
// kriegen Notification ueber Aenderungen via Cron-Job (Sprint 1.5+
// oder S9 compliance-as-product). RSS-Feed kommt in S9.
//
// Zwei Auflistungen statt einer flachen Liste:
//   - `active`: aktuell eingesetzte Sub-Processors
//   - `planned`: bekannte zukünftige Sub-Processors (Tenant-Admin-
//     Lead-Time bevor sie aktiv werden — typisch bei AI/Stripe)
export const subProcessorsQuery = defineQueryHandler({
  name: "sub-processors",
  schema: z.object({}),
  access: { roles: ["anonymous", "Member", "User", "TenantAdmin", "SystemAdmin"] },
  handler: async (): Promise<SubProcessorListResponse> => {
    return {
      active: [...getActiveSubProcessors()],
      planned: [...getPlannedSubProcessors()],
      generatedAt: new Date().toISOString(),
      total: KUMIKO_SUB_PROCESSORS.length,
    };
  },
});

interface SubProcessorListResponse {
  readonly active: readonly SubProcessor[];
  readonly planned: readonly SubProcessor[];
  readonly generatedAt: string;
  readonly total: number;
}
