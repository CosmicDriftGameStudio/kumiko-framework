import type { BootRuleTable } from "./boot-rule.ts";

export const BOOT_ENVIRONMENT_RULES = {
  fileStorageProviderMissing: {
    id: "file-storage/provider-env-missing",
    summary:
      "An app with file or image fields sets the FILE_STORAGE_PROVIDER environment variable.",
    fix: "Set FILE_STORAGE_PROVIDER in the environment.",
  },
  duplicateExposedApi: {
    id: "api/duplicate-exposed-name",
    summary: "A cross-feature API name is exposed by exactly one feature.",
    fix: "Rename the API in one of the exposing features.",
  },
} as const satisfies BootRuleTable;
