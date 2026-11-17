import { requireSystemDb } from "@cosmicdrift/kumiko-framework/db";
import {
  defineFeature,
  EXT_PRINCIPAL_STATUS,
  type FeatureDefinition,
  HookPhases,
} from "@cosmicdrift/kumiko-framework/engine";
import { revokeAllUserCredentials } from "../auth-foundation/index.ts";
import { createWrite } from "./handlers/create.write.ts";
import { detailQuery } from "./handlers/detail.query.ts";
import { findForAuthQuery } from "./handlers/find-for-auth.query.ts";
import { listQuery } from "./handlers/list.query.ts";
import { meQuery } from "./handlers/me.query.ts";
import { updateWrite } from "./handlers/update.write.ts";
import { USER_I18N } from "./i18n.ts";
import { principalStatusPlugin } from "./principal-status.ts";
import { userEntity } from "./schema/user.ts";
import { userEditScreen, userListScreen } from "./screens.ts";

const PASSWORD_CHANGE_REVOKE_REASON =
  "a password change revokes every session and access token of the user across all tenants";

// The user feature holds the cross-tenant user identity. `systemScope()` means
// queries and writes bypass the tenant filter — a user exists above any tenant.
// Membership + tenant-specific roles live in the tenant feature.
export function createUserFeature(): FeatureDefinition {
  return defineFeature("user", (r) => {
    r.describe(
      "Manages the cross-tenant user identity: the `read_users` table holds each user's email, `displayName`, global `roles`, `emailVerified` flag, and lifecycle `status` (active / restricted / deletionRequested / deleted). Because users exist above any individual tenant, the feature runs with `r.systemScope()` \u2014 membership and tenant-specific roles live in the `tenant` feature instead. Add this feature whenever your app needs a persistent, tenant-agnostic user record that auth and GDPR pipelines can reference.",
    );
    r.uiHints({
      displayLabel: "User Identity",
      category: "identity",
      recommended: true,
    });
    r.systemScope();
    r.entity({ name: "user", ...userEntity });

    // Self-extension: `user` declares AND fulfils principalStatus (precedent:
    // tier-engine/feature.ts) — wires the blocked-principal check into every stack that mounts `user`.
    r.extendsRegistrar(EXT_PRINCIPAL_STATUS, {});
    r.useExtension(EXT_PRINCIPAL_STATUS, "user", principalStatusPlugin);

    r.hook({
      type: "postSave",
      target: { allOf: "user" },
      phase: HookPhases.inTransaction,
      escapeHatch: { grants: ["unsafeRaw"], reason: PASSWORD_CHANGE_REVOKE_REASON },
      handler: async (result, ctx) => {
        // skip: a new user has no sessions or tokens yet
        if (result.isNew) return;
        // skip: only a password change invalidates existing credentials
        if (result.changes["passwordHash"] === undefined) return;
        // user is r.systemScope(): ctx.db is a guard proxy, the tx runner comes from ctx.systemDb.
        const runner = requireSystemDb(ctx, "user password-change credential revoke").unsafeRaw(
          PASSWORD_CHANGE_REVOKE_REASON,
        );
        await revokeAllUserCredentials(ctx.registry, runner, String(result.id), {});
      },
    });

    const handlers = {
      create: r.writeHandler(createWrite),
      update: r.writeHandler(updateWrite),
    };

    const queries = {
      me: r.queryHandler(meQuery),
      detail: r.queryHandler(detailQuery),
      list: r.queryHandler(listQuery),
      findForAuth: r.queryHandler(findForAuthQuery),
    };

    // Cross-tenant SystemAdmin platform screens. Inert until an app navs them;
    // list/detail/create/update handlers above already sit on the QNs that
    // entityList/entityEdit resolve by convention (user:query:user:{list,detail},
    // user:write:user:{create,update}).
    r.screen(userListScreen);
    r.screen(userEditScreen);

    r.translations({ keys: USER_I18N });

    return { handlers, queries };
  });
}
