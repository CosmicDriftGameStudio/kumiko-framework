import {
  access,
  createSystemConfig,
  createTenantConfig,
  defineFeature,
  type FeatureDefinition,
} from "@kumiko/framework/engine";
import { activeTenantIdsQuery } from "./handlers/active-tenant-ids.query";
import { addMemberWrite } from "./handlers/add-member.write";
import { createWrite } from "./handlers/create.write";
import { disableWrite } from "./handlers/disable.write";
import { listQuery } from "./handlers/list.query";
import { meQuery } from "./handlers/me.query";
import { membersQuery } from "./handlers/members.query";
import { membershipsQuery } from "./handlers/memberships.query";
import { removeMemberWrite } from "./handlers/remove-member.write";
import { resolveUserIdsQuery } from "./handlers/resolve-user-ids.query";
import { updateWrite } from "./handlers/update.write";
import { updateMemberRolesWrite } from "./handlers/update-member-roles.write";
import { tenantMembershipEntity } from "./membership-table";
import { tenantEntity } from "./tenant-entity";

export { tenantEntity, tenantTable } from "./tenant-entity";

// --- Feature ---

export function createTenantFeature(): FeatureDefinition {
  return defineFeature("tenant", (r) => {
    r.systemScope();
    r.requires("config");
    r.entity("tenant", tenantEntity);
    r.entity("tenant-membership", tenantMembershipEntity);

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
      addMember: r.writeHandler(addMemberWrite),
      removeMember: r.writeHandler(removeMemberWrite),
      updateMemberRoles: r.writeHandler(updateMemberRolesWrite),
    };

    // Queries
    const queries = {
      me: r.queryHandler(meQuery),
      list: r.queryHandler(listQuery),
      memberships: r.queryHandler(membershipsQuery),
      members: r.queryHandler(membersQuery),
      activeTenantIds: r.queryHandler(activeTenantIdsQuery),
      resolveUserIds: r.queryHandler(resolveUserIdsQuery),
    };

    return { handlers, queries };
  });
}
