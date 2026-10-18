import {
  access,
  assignableAppRolesOf,
  canActorAssignRole,
  defineQueryHandler,
} from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { memberRoleOptions } from "../member-role-options.ts";

export const memberRoleAvailabilityQuery = defineQueryHandler({
  name: "member-role-availability",
  schema: z.object({}),
  access: { roles: access.admin },
  description:
    "Lists every role the member roles form offers and whether the caller's own rank may assign it; the form hides the roles marked disabled.",
  handler: async (query, ctx) => {
    const assignableAppRoles = assignableAppRolesOf(ctx.registry);
    return {
      rows: memberRoleOptions(assignableAppRoles).map((value) => ({
        value,
        disabled: !canActorAssignRole(query.user.roles, value, assignableAppRoles),
      })),
    };
  },
});
