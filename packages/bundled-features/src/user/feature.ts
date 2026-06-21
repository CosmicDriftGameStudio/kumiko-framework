import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { createWrite } from "./handlers/create.write";
import { detailQuery } from "./handlers/detail.query";
import { findForAuthQuery } from "./handlers/find-for-auth.query";
import { listQuery } from "./handlers/list.query";
import { meQuery } from "./handlers/me.query";
import { updateWrite } from "./handlers/update.write";
import { userEntity } from "./schema/user";

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
    r.entity("user", userEntity);

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

    return { handlers, queries };
  });
}
