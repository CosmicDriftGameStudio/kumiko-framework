// Public API of foundation-shared — utilities consumed by the per-tenant
// Foundation packages (ai-foundation, mail-foundation, file-foundation).

export { buildInfoEnvSchema } from "./build-info-env.js";
export { requireDefined, requireNonEmpty, requireSecretSet } from "./config-helpers.js";
export { demoAdminEnvSchema } from "./demo-admin-env.js";
export { isHostAllowlisted, readHostAllowlistFromEnv } from "./host-allowlist.js";
export {
  BlockedHostError,
  HostResolutionError,
  MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR,
  type MailConnectTarget,
  type MailHostGuardOptions,
  mailAllowedPrivateHostsEnvSchema,
  readAllowedPrivateMailHostsFromEnv,
  resolveMailConnectTarget,
} from "./mail-host-policy.js";
