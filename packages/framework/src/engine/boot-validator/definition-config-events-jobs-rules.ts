import type { BootRuleTable } from "./boot-rule.ts";

export const DEFINITION_CONFIG_EVENTS_JOBS_RULES = {
  jobMaintenanceTriggerInvalid: {
    id: "job/maintenance-trigger-invalid",
    summary: "A job maintenance trigger has the value true.",
    fix: "Use trigger { maintenance: true }.",
  },
  jobWakesSleepingAppInvalid: {
    id: "job/wakes-sleeping-app-invalid",
    summary: "wakesSleepingApp is false and only on cron or maintenance triggers.",
    fix: "Use wakesSleepingApp: false on a cron or maintenance trigger, or omit it.",
  },
  jobCronTimezoneInvalid: {
    id: "job/cron-timezone-invalid",
    summary: "A cron trigger tz is an IANA time zone name.",
    fix: 'Use a zone name such as "Europe/Berlin".',
  },
  jobEscapeHatchInvalid: {
    id: "job/escape-hatch-invalid",
    summary: "A job escapeHatch carries a valid reason and grants.",
    fix: "Fix the escapeHatch reason or grants as the message describes.",
  },
  configSingleKeyNeedsDefinition: {
    id: "config/single-key-needs-definition",
    summary: "The single-key config() form receives a definition as second argument.",
    fix: "Pass the key definition as the second argument.",
  },
  eventMigrationStepSize: {
    id: "event/migration-step-size",
    summary: "Event migrations move exactly one version up.",
    fix: "Declare each version step separately with toVersion = fromVersion + 1.",
  },
  eventMigrationFromVersionInvalid: {
    id: "event/migration-from-version-invalid",
    summary: "Event migrations start at fromVersion 1 or higher.",
    fix: "Set fromVersion to 1 or higher.",
  },
  eventMigrationDuplicateStep: {
    id: "event/migration-duplicate-step",
    summary: "Each event migration step is declared once.",
    fix: "Remove the duplicate migration for that fromVersion.",
  },
  eventMigrationRenameCollision: {
    id: "event/migration-rename-collision",
    summary: "A declarative migration maps at most one source to each rename target.",
    fix: "Rename only one source field to the target.",
  },
  metricDuplicate: {
    id: "metric/name-duplicate",
    summary: "Metric names are unique per feature.",
    fix: "Rename one of the metrics.",
  },
  envSchemaTwice: {
    id: "env-schema/declared-twice",
    summary: "A feature calls r.envSchema() at most once.",
    fix: "Compose all env keys into one Zod object.",
  },
  secretDuplicate: {
    id: "secret/key-duplicate",
    summary: "Secret key names are unique per feature.",
    fix: "Rename one of the secrets.",
  },
  secretWriteRolesEmpty: {
    id: "secret/write-roles-empty",
    summary: "A secret or namespace writeRoles list is non-empty.",
    fix: "Add roles or omit writeRoles to use the secrets handler access.",
  },
  secretNamespaceDuplicate: {
    id: "secret/namespace-duplicate",
    summary: "Secret namespace names are unique per feature.",
    fix: "Rename one of the namespaces.",
  },
  claimKeyDuplicate: {
    id: "claim/key-duplicate",
    summary: "Claim short names are unique per feature.",
    fix: "Rename one of the claims.",
  },
} as const satisfies BootRuleTable;
