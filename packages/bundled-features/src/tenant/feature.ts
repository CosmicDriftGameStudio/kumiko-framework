import {
  access,
  createSystemConfig,
  createTenantConfig,
  defineFeature,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { activeTenantIdsQuery } from "./handlers/active-tenant-ids.query";
import { addMemberWrite } from "./handlers/add-member.write";
import { cancelInvitationWrite } from "./handlers/cancel-invitation.write";
import { createWrite } from "./handlers/create.write";
import { invitationsQuery } from "./handlers/invitations.query";
import { listQuery } from "./handlers/list.query";
import { meQuery } from "./handlers/me.query";
import { membersQuery } from "./handlers/members.query";
import { membershipsQuery } from "./handlers/memberships.query";
import { removeMemberWrite } from "./handlers/remove-member.write";
import { resolveUserIdsQuery } from "./handlers/resolve-user-ids.query";
import { disableWrite, enableWrite } from "./handlers/toggle-enabled.write";
import { updateWrite } from "./handlers/update.write";
import { updateMemberRolesWrite } from "./handlers/update-member-roles.write";
import { tenantInvitationEntity } from "./invitation-table";
import { tenantMembershipEntity } from "./membership-table";
import { tenantEntity } from "./schema/tenant";

export { tenantEntity, tenantTable } from "./schema/tenant";

// --- Feature ---

export function createTenantFeature(): FeatureDefinition {
  return defineFeature("tenant", (r) => {
    r.describe(
      "Registers the three core multi-tenancy entities \u2014 `tenant`, `tenant-membership`, and `tenant-invitation` (DB tables `read_tenants`, `read_tenant_memberships`, and `read_tenant_invitations`) \u2014 along with write handlers for create/update/disable/enable/addMember/removeMember/updateMemberRoles and the matching queries. It also declares a set of per-tenant config keys (companyName, timezone, locale, SMTP credentials) and system-only keys (priceModel, maxUsers) via `r.config({ keys: { ... } })`. Use this feature in every multi-tenant app; membership resolution and invitation flows depend on it, and `auth-email-password` requires it.",
    );
    r.systemScope();
    r.requires("config");
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
      activeTenantIds: r.queryHandler(activeTenantIdsQuery),
      resolveUserIds: r.queryHandler(resolveUserIdsQuery),
      invitations: r.queryHandler(invitationsQuery),
    };

    return { handlers, queries };
  });
}
