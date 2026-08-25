type LocalizedString = { readonly en: string };

export const USER_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:user-list.title": { en: "Users" },
  "screen:user-edit.title": { en: "Edit user" },
  "user:entity:user:field:email": { en: "Email" },
  "user:entity:user:field:displayName": { en: "Display name" },
  "user:entity:user:field:roles": { en: "Platform roles" },
  "user:entity:user:field:tenants": { en: "Tenants" },
  "user:entity:user:field:tenants:description": {
    en: "Membership tenants with roles, e.g. Offlot Demo (TenantAdmin). Edit under Team → Members.",
  },
  "user:entity:user:field:roles:description": {
    en: "Global platform roles only (SystemAdmin). TenantAdmin/Admin are membership roles under Team → Members.",
  },
  "user:entity:user:field:roles:option:SystemAdmin": { en: "SystemAdmin" },
  "user:entity:user:field:status": { en: "Status" },
  "user:entity:user:field:emailVerified": { en: "Email verified" },
  "user:entity:user:field:locale": { en: "Locale" },
  "user:entity:user:field:timezone": { en: "Timezone" },
  "user:entity:user:field:status:option:active": { en: "Active" },
  "user:entity:user:field:status:option:restricted": { en: "Restricted" },
  "user:entity:user:field:status:option:deletionRequested": {
    en: "Deletion requested",
  },
  "user:entity:user:field:status:option:deleted": { en: "Deleted" },
  "user:entity:user:field:emailVerified:option:true": { en: "Yes" },
  "user:entity:user:field:emailVerified:option:false": { en: "No" },
};
