// Public API of foundation-shared — utilities consumed by the per-tenant
// Foundation packages (ai-foundation, mail-foundation, file-foundation).

export { requireDefined, requireNonEmpty, requireSecretSet } from "./config-helpers.js";
export {
  BlockedHostError,
  HostResolutionError,
  MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR,
  type MailConnectTarget,
  type MailHostGuardOptions,
  readAllowedPrivateMailHostsFromEnv,
  resolveMailConnectTarget,
} from "./mail-host-policy.js";
