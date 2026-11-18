import type { BootRuleTable } from "@cosmicdrift/kumiko-framework/engine";

export const USER_DATA_RIGHTS_BOOT_RULES = {
  emptyHook: {
    id: "user-data-rights/empty-hook",
    summary: "An EXT_USER_DATA registration declares at least one of an export or a delete hook.",
    fix: "Register at least one hook.",
  },
  exportWithoutDelete: {
    id: "user-data-rights/export-without-delete",
    summary: "An entity exported via EXT_USER_DATA also registers a delete hook.",
    fix: "Add a delete hook, or a documented no-op delete if erasure is handled elsewhere.",
  },
  missingHook: {
    id: "user-data-rights/missing-hook",
    summary: "An entity with user-subject fields registers an EXT_USER_DATA hook.",
    fix: "Register r.applyExtension({ name: EXT_USER_DATA, ... }) for the entity, or a documented no-op hook if it is covered elsewhere.",
  },
  mailAppNameMissing: {
    id: "user-data-rights/mail-app-name-missing",
    summary:
      "When the default GDPR mails can go out, mailDefaults.appName names the app in their subject and body.",
    fix: 'Pass createUserDataRightsFeature({ mailDefaults: { appName: "<your app>" } }), or set every send*Email callback and leave the anonymous deletion flow off.',
  },
} as const satisfies BootRuleTable;
