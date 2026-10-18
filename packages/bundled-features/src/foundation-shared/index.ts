// Public API of foundation-shared — utilities consumed by the per-tenant
// Foundation packages (ai-foundation, mail-foundation, file-foundation).

export { buildInfoEnvSchema } from "./build-info-env.ts";
export { requireDefined, requireNonEmpty, requireSecretSet } from "./config-helpers.ts";
export { demoAdminEnvSchema } from "./demo-admin-env.ts";
export { isHostAllowlisted, readHostAllowlistFromEnv } from "./host-allowlist.ts";
export {
  BlockedHostError,
  HostResolutionError,
  MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR,
  type MailConnectTarget,
  type MailHostGuardOptions,
  mailAllowedPrivateHostsEnvSchema,
  readAllowedPrivateMailHostsFromEnv,
  resolveMailConnectTarget,
} from "./mail-host-policy.ts";
