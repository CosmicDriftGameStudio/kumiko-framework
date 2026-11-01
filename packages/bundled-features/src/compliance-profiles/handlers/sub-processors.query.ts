import {
  getActiveSubProcessors,
  getPlannedSubProcessors,
  KUMIKO_SUB_PROCESSORS,
  type SubProcessor,
} from "@cosmicdrift/kumiko-framework/compliance";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import * as z from "zod";

// Public sub-processor list, accessible anonymously. This satisfies the GDPR Art. 28(2) requirement
// that the list of processors be publicly accessible, typically linked from
// the privacy policy and data-processing agreement.
//
// Format: JSON with separate active/planned sections. Tenant admins receive
// change notifications via a cron job.
//
// Two lists are used instead of one flat list:
//   - `active`: sub-processors currently in use
//   - `planned`: known future sub-processors, giving tenant admins lead time
//     before activation, as is typical for AI and Stripe providers.
export const subProcessorsQuery = defineQueryHandler({
  name: "sub-processors",
  schema: z.object({}),
  access: {
    roles: ["anonymous", "Member", "User", "TenantAdmin", "SystemAdmin"],
    anySignedIn: true,
  },
  rateLimit: { per: "ip+handler", limit: 30, windowSeconds: 60 },
  description:
    "Returns the publicly readable Kumiko sub-processor list split into active and planned entries, for the GDPR Art. 28(2) disclosure a privacy policy or data-processing agreement links to.",
  handler: async (): Promise<SubProcessorListResponse> => {
    return {
      active: [...getActiveSubProcessors()],
      planned: [...getPlannedSubProcessors()],
      generatedAt: getTemporal().Now.instant().toString(),
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
