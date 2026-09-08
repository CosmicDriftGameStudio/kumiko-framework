import {
  defineEntityCreateHandler,
  defineEntityDeleteHandler,
  defineEntityDetailHandler,
  defineEntityListHandler,
  defineEntityUpdateHandler,
} from "@cosmicdrift/kumiko-framework/engine";
import { pageEntity } from "../table";

// Admin authoring runs as TenantAdmin (self-service) or SystemAdmin (app-wide
// pages). Mirrors set.write's ACL — an app with its own role alias
// (publicstatus = "Admin") has to grant or map TenantAdmin.
const ADMIN_ACCESS = { roles: ["TenantAdmin", "SystemAdmin"] } as const;

// Convention CRUD behind the admin screens: entityEdit/entityList dispatch
// `managed-pages:write:page:{create,update,delete}` +
// `managed-pages:query:page:{list,detail}` by convention. The `set` write
// handler in feature.ts is NOT used by them and stays the provisioning API.
export const pageCrudWrites = [
  defineEntityCreateHandler("page", pageEntity, {
    access: ADMIN_ACCESS,
    description:
      "Creates a managed page from the admin form's field values, failing if that slug and language already exist; use it from the page catalog screen, whereas managed-pages:write:set upserts a page addressed by slug and language.",
  }),
  defineEntityUpdateHandler("page", pageEntity, {
    access: ADMIN_ACCESS,
    description:
      "Updates one managed page addressed by row id from the admin form's `{ id, version, changes }` envelope; use it from the page edit screen, whereas managed-pages:write:set addresses a page by slug and language instead.",
  }),
  defineEntityDeleteHandler("page", pageEntity, {
    access: ADMIN_ACCESS,
    description:
      "Deletes one managed page by row id so its URL stops resolving entirely; use it to retire a page for good, not to take it offline temporarily — that is a published:false write through managed-pages:write:set.",
    agent: { risk: "high" },
  }),
];

export const pageCrudQueries = [
  defineEntityListHandler("page", pageEntity, {
    access: ADMIN_ACCESS,
    description:
      "Lists the tenant's managed pages for the admin catalog, drafts included; use it to browse or search pages for editing, unlike by-tenant-published which only enumerates the publicly visible ones.",
  }),
  defineEntityDetailHandler("page", pageEntity, {
    access: ADMIN_ACCESS,
    description:
      "Reads one managed page by row id including its body and draft state; use it to load a page into the admin edit screen, whereas by-slug serves the public render path.",
  }),
];
