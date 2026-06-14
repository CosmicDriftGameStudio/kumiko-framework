import {
  type ConfigEditScreenDefinition,
  createSelectField,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";
import { BRANDING_QN, LAYOUT_PRESETS } from "../branding";

// Tenant self-service branding editor. A `configEdit` screen (no entity
// table) — the renderer loads config:query:values, maps the form fields via
// `configKeys` to the qualified config keys, and submits config:write:set per
// key on save (where the keyDef.pattern gate runs). scope:tenant → writes land
// on the acting admin's tenant. Nav/workspace placement stays App-Sache, like
// the page screens; without an `r.nav` pointing here the screen is dormant.
//
// Roles include "Admin" (App-Repos like publicstatus) alongside "TenantAdmin"
// (bundled-features) — the access.admin config preset writes both, so editing
// works in either role world (Role-Naming-Drift).
const ADMIN_ROLES = ["TenantAdmin", "Admin", "SystemAdmin"] as const;

export const brandingSettingsScreen: ConfigEditScreenDefinition = {
  id: "branding-settings",
  type: "configEdit",
  scope: "tenant",
  configKeys: {
    title: BRANDING_QN.title,
    description: BRANDING_QN.description,
    siteUrl: BRANDING_QN.siteUrl,
    accentColor: BRANDING_QN.accentColor,
    logoUrl: BRANDING_QN.logoUrl,
    layoutPreset: BRANDING_QN.layoutPreset,
  },
  fields: {
    title: createTextField({ maxLength: 200 }),
    description: createTextField({ maxLength: 500, multiline: { rows: 3 } }),
    siteUrl: createTextField({ maxLength: 2000, format: "url" }),
    accentColor: createTextField({ maxLength: 9 }),
    logoUrl: createTextField({ maxLength: 2000, format: "url" }),
    layoutPreset: createSelectField({ options: LAYOUT_PRESETS }),
  },
  layout: {
    sections: [
      {
        title: "managed-pages:branding.section.identity",
        columns: 2,
        fields: [
          { field: "title", span: 1 },
          { field: "layoutPreset", span: 1 },
          { field: "description", span: 2 },
          { field: "siteUrl", span: 1 },
          { field: "logoUrl", span: 1 },
          { field: "accentColor", span: 1 },
        ],
      },
    ],
  },
  access: { roles: ADMIN_ROLES },
};
