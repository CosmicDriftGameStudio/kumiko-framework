import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import type { SubjectId } from "@cosmicdrift/kumiko-framework/crypto";
import { createSystemUser, parseTenantId } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError, reraiseAsKumikoError } from "@cosmicdrift/kumiko-framework/errors";
import type { HookDefinition } from "@cosmicdrift/kumiko-types/feature-registrar";
import { FORGET_SUBJECT_QUALIFIED_NAME } from "./constants.ts";

export type SubjectForgetAfterDeleteOptions = {
  readonly target: Extract<HookDefinition, { type: "postDelete" }>["target"];
  readonly subjectsOf: (deletedId: string) => readonly SubjectId[];
  // forget-subject requires at least 10 characters.
  readonly reason: string;
};

// A postDelete hook, not a step inside the delete handler: preDelete hooks run after the handler
// returns, and the key erase cannot be rolled back. Run here, in the delete's own transaction, the
// erase only happens once every preDelete hook has accepted the delete; a failed forget throws and
// rolls the delete back. The escalation stays in the tenant of the deleted row's own event.
// forget-subject is irreversible (assertIrreversibleOperationAllowed), so the consumer's delete
// handler (the entry handler) must resolve to agent risk "high", otherwise the hook fails.
export function subjectForgetAfterDeleteHook(
  options: SubjectForgetAfterDeleteOptions,
): Extract<HookDefinition, { type: "postDelete" }> {
  return {
    type: "postDelete",
    target: options.target,
    phase: "inTransaction",
    escapeHatch: {
      reason: `deleting the row escalates to the system identity to run crypto-shredding:forget-subject (DPO/SystemAdmin-only) for the subjects of the row just deleted in its own tenant: ${options.reason}`,
      grants: ["systemIdentity"],
    },
    handler: async (deleted, ctx) => {
      const tenantId = parseTenantId(deleted.event.tenantId);
      if (tenantId === null) {
        throw new InternalError({
          message: "[crypto-shredding] subjectForgetAfterDeleteHook: deleted row has no tenant",
        });
      }
      const systemAdmin = createSystemUser(tenantId, [ROLES.SystemAdmin]);
      for (const subject of options.subjectsOf(String(deleted.id))) {
        const forgotten = await ctx.dispatch.writeAs(systemAdmin, FORGET_SUBJECT_QUALIFIED_NAME, {
          subject,
          reason: options.reason,
        });
        if (!forgotten.isSuccess) throw reraiseAsKumikoError(forgotten.error);
      }
    },
  };
}
