import { escapeHatchAllows } from "@cosmicdrift/kumiko-types/handlers";
import { ROLES } from "../../auth/roles.ts";
import type { FeatureDefinition } from "../types/index.ts";
import { bootRuleError } from "./boot-rule.ts";
import { DEFINITION_CONFIG_EVENTS_JOBS_RULES } from "./definition-config-events-jobs-rules.ts";
import { checkRoleListAccess } from "./ownership.ts";

export function validateJobRunAs(
  feature: FeatureDefinition,
  knownRoles: ReadonlySet<string> | undefined,
): void {
  for (const [jobName, job] of Object.entries(feature.jobs)) {
    // skip: a job without runAs keeps the bare system identity
    if (!job.runAs) continue;
    checkRoleListAccess(job.runAs.roles, knownRoles, `job "${jobName}" runAs`, feature.name);
    const runsAsSystemAdmin = job.runAs.roles.includes(ROLES.SystemAdmin);
    if (
      runsAsSystemAdmin &&
      !feature.systemScope &&
      !escapeHatchAllows(job.escapeHatch, "systemIdentity")
    ) {
      throw bootRuleError(DEFINITION_CONFIG_EVENTS_JOBS_RULES.jobRunAsSystemAdminUngranted, {
        message: `[Feature ${feature.name}] r.job("${jobName}") runs as SystemAdmin, which can write into other tenants, without an escapeHatch granting systemIdentity or r.systemScope()`,
      });
    }
  }
}
