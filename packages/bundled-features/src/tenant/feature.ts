import {
  type AssignableAppRoles,
  access,
  assignableAppRolesFromUsages,
  createSystemConfig,
  createTenantConfig,
  defineEntityDetailHandler,
  defineEntityListHandler,
  defineEntityUpdateHandler,
  defineFeature,
  EXT_ASSIGNABLE_ROLE,
  type FeatureDefinition,
  i18nKey,
} from "@cosmicdrift/kumiko-framework/engine";
import { activeTenantIdsQuery } from "./handlers/active-tenant-ids.query.js";
import { addMemberWrite } from "./handlers/add-member.write.js";
import { cancelInvitationWrite } from "./handlers/cancel-invitation.write.js";
import { createWrite } from "./handlers/create.write.js";
import { invitationsQuery } from "./handlers/invitations.query.js";
import { listQuery } from "./handlers/list.query.js";
import { meQuery } from "./handlers/me.query.js";
import { memberDirectoryQuery } from "./handlers/member-directory.query.js";
import { membersQuery } from "./handlers/members.query.js";
import { membershipsQuery } from "./handlers/memberships.query.js";
import { removeMemberWrite } from "./handlers/remove-member.write.js";
import { resolveUserIdsQuery } from "./handlers/resolve-user-ids.query.js";
import { teamListQuery } from "./handlers/team-list.query.js";
import { tenantDirectoryQuery } from "./handlers/tenant-directory.query.js";
import { disableWrite, enableWrite } from "./handlers/toggle-enabled.write.js";
import { updateWrite } from "./handlers/update.write.js";
import { updateMemberRolesWrite } from "./handlers/update-member-roles.write.js";
import { TENANT_I18N } from "./i18n.js";
import { tenantInvitationEntity } from "./invitation-table.js";
import { tenantMembershipEntity } from "./membership-table.js";
import { tenantEntity } from "./schema/tenant.js";
import {
  createInviteCreateScreen,
  createMemberRolesEditScreen,
  createMembersScreen,
  tenantEditScreen,
  tenantListScreen,
} from "./screens.js";

export { tenantEntity, tenantTable } from "./schema/tenant.js";

export type TenantFeatureOptions = {
  /** Adds the /members "invite" drawer button + its `invite-create`
   *  actionForm, bound to auth-email-password's `invite-create` write-
   *  handler. That handler only exists when the app also mounts
   *  `createAuthEmailPasswordFeature({ invite: {...} })` — the boot
   *  validator rejects the actionForm's handler QN otherwise (cross-feature
   *  handler lookup fails). Off by default: `tenant` cannot see whether an
   *  app configured that optional auth-email-password flow. */
  readonly inviteScreen?: boolean;
  /** Screen options only — the elevation guard always reads the registry. */
  readonly assignableAppRoles?: AssignableAppRoles;
};

export function collectAssignableAppRoles(
  features: readonly FeatureDefinition[],
): AssignableAppRoles {
  return assignableAppRolesFromUsages(
    features
      .flatMap((feature) => feature.extensionUsages)
      .filter((usage) => usage.extensionName === EXT_ASSIGNABLE_ROLE),
  );
}

// --- Feature ---

export function createTenantFeature(options?: TenantFeatureOptions): FeatureDefinition {
  return defineFeature("tenant", (r) => {
    r.describe(
      "Registers the three core multi-tenancy entities \u2014 `tenant`, `tenant-membership`, and `tenant-invitation` (DB tables `read_tenants`, `read_tenant_memberships`, and `read_tenant_invitations`) \u2014 along with write handlers for create/update/disable/enable/addMember/removeMember/updateMemberRoles and the matching queries. It also declares a set of per-tenant config keys (companyName, timezone, locale, SMTP credentials) and system-only keys (priceModel, maxUsers) via `r.config({ keys: { ... } })`. Use this feature in every multi-tenant app; membership resolution and invitation flows depend on it, and `auth-email-password` requires it.",
    );
    r.uiHints({
      displayLabel: "Multi-Tenant Core",
      category: "identity",
      recommended: true,
    });
    r.systemScope();
    r.requires("config");
    r.extendsRegistrar(EXT_ASSIGNABLE_ROLE, {});
    r.bootCheck(({ features }) => {
      collectAssignableAppRoles(features);
    });
    r.entity("tenant", tenantEntity);
    r.entity("tenant-membership", tenantMembershipEntity);
    r.entity("tenant-invitation", tenantInvitationEntity);

    r.config({
      keys: {
        // Stammdaten-Settings — Tenant-Admin darf ändern, alle dürfen lesen.
        companyName: createTenantConfig("text", { default: "" }),
        // Pragmatisch kuratierte Liste — IANA hat hunderte, hier die in der
        // Praxis relevantesten. Erweiterung später wenn echter Bedarf.
        timezone: createTenantConfig("select", {
          default: "Europe/Berlin",
          options: [
            "UTC",
            "Europe/Berlin",
            "Europe/London",
            "Europe/Paris",
            "Europe/Madrid",
            "Europe/Rome",
            "America/New_York",
            "America/Los_Angeles",
            "America/Sao_Paulo",
            "Asia/Tokyo",
            "Asia/Singapore",
            "Australia/Sydney",
          ],
        }),
        locale: createTenantConfig("select", {
          default: "de",
          options: ["de", "en", "fr", "es"],
        }),

        // SMTP — nur SystemAdmin (Plattform-Operator) ändert; smtpPass ist
        // verschlüsselt + nur für SystemAdmin lesbar.
        smtpHost: createTenantConfig("text", { write: access.systemAdmin, read: access.admin }),
        smtpPass: createTenantConfig("text", {
          write: access.systemAdmin,
          read: access.systemAdmin,
          encrypted: true,
        }),

        // System-Settings — nur programmatisch (SYSTEM_USER) änderbar,
        // Tenant-Admin sieht readonly.
        priceModel: createSystemConfig("select", {
          default: "basic",
          options: ["basic", "pro", "enterprise"],
        }),
        maxUsers: createSystemConfig("number", { default: 50 }),
      },
    });

    // Tenant CRUD
    const handlers = {
      create: r.writeHandler(createWrite),
      update: r.writeHandler(updateWrite),
      disable: r.writeHandler(disableWrite),
      enable: r.writeHandler(enableWrite),
      addMember: r.writeHandler(addMemberWrite),
      removeMember: r.writeHandler(removeMemberWrite),
      updateMemberRoles: r.writeHandler(updateMemberRolesWrite),
      cancelInvitation: r.writeHandler(cancelInvitationWrite),
    };

    // Queries
    const queries = {
      me: r.queryHandler(meQuery),
      list: r.queryHandler(listQuery),
      memberships: r.queryHandler(membershipsQuery),
      members: r.queryHandler(membersQuery),
      memberDirectory: r.queryHandler(memberDirectoryQuery),
      tenantDirectory: r.queryHandler(tenantDirectoryQuery),
      activeTenantIds: r.queryHandler(activeTenantIdsQuery),
      resolveUserIds: r.queryHandler(resolveUserIdsQuery),
      invitations: r.queryHandler(invitationsQuery),
      teamList: r.queryHandler(teamListQuery),
    };

    // Entity-convention handlers for the SystemAdmin entityList/entityEdit
    // screens. The feature's original handlers predate the `<entity>:<verb>`
    // naming (they sit on tenant:query:list / tenant:write:update); entityList/
    // entityEdit resolve tenant:query:tenant:{list,detail} + tenant:write:tenant:
    // update by convention, so these are added alongside (no rename = no break
    // for existing callers). Cross-tenant because the feature is systemScope.
    r.queryHandler(
      defineEntityListHandler("tenant", tenantEntity, {
        access: { roles: ["SystemAdmin"] },
        description:
          "Lists tenants under the entity-convention name the generated SystemAdmin tenant-list screen resolves; tenant:query:list is the hand-written equivalent.",
      }),
    );
    r.queryHandler(
      defineEntityDetailHandler("tenant", tenantEntity, {
        access: { roles: ["SystemAdmin"] },
        description:
          "Loads a single tenant by id under the entity-convention name the generated SystemAdmin tenant-edit screen resolves.",
      }),
    );
    r.writeHandler(
      defineEntityUpdateHandler("tenant", tenantEntity, {
        access: { roles: ["SystemAdmin"] },
        description:
          "Saves edits to a tenant's own fields under the entity-convention name the generated SystemAdmin tenant-edit screen resolves; tenant:write:update is the hand-written equivalent.",
      }),
    );
    r.screen(tenantListScreen);
    r.screen(tenantEditScreen);
    // Tenant-admin team UI: one list (active members + pending invitations,
    // §2.6), invite via a drawer-hosted actionForm, role-edit via
    // actionForm. Screen access matches handler access.admin.
    r.screen(createMembersScreen(options));
    r.screen(createMemberRolesEditScreen(options?.assignableAppRoles));
    if (options?.inviteScreen) {
      r.screen(createInviteCreateScreen(options.assignableAppRoles));
    }
    r.nav({
      id: "members",
      label: i18nKey("tenant.nav.members"),
      icon: "users",
      screen: "tenant:screen:members",
      order: 20,
    });

    r.translations({ keys: TENANT_I18N });

    return { handlers, queries };
  });
}
