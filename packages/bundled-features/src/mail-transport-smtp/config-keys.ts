import { access, createTenantConfig } from "@cosmicdrift/kumiko-framework/engine";

// No SystemAdmin write: the password is a tenant secret, so platform-level SMTP keys
// could never form a working transport (see mail-foundation's provider key).
const tenantAdminWrite = access.withSystem(access.roles("TenantAdmin"));
const tenantAdminRead = access.roles("TenantAdmin", "SystemAdmin");

// required: true ↔ the requireNonEmpty calls in buildSmtpTransport — keep in sync.
// authUser stays optional: empty means an unauthenticated relay.
export const SMTP_CONFIG_KEYS = {
  host: createTenantConfig("text", {
    required: true,
    default: "",
    write: tenantAdminWrite,
    read: tenantAdminRead,
    mask: {
      title: "mail-transport-smtp.host",
      description: "mail-transport-smtp.host.description",
      icon: "server",
      order: 1,
    },
  }),
  port: createTenantConfig("number", {
    default: 587,
    bounds: { min: 1, max: 65535 },
    write: tenantAdminWrite,
    mask: {
      title: "mail-transport-smtp.port",
      description: "mail-transport-smtp.port.description",
      icon: "hash",
      order: 2,
    },
  }),
  secure: createTenantConfig("boolean", {
    default: false,
    write: tenantAdminWrite,
    mask: {
      title: "mail-transport-smtp.secure",
      description: "mail-transport-smtp.secure.description",
      icon: "lock",
      order: 3,
    },
  }),
  authUser: createTenantConfig("text", {
    default: "",
    write: tenantAdminWrite,
    read: tenantAdminRead,
    mask: {
      title: "mail-transport-smtp.authUser",
      description: "mail-transport-smtp.authUser.description",
      icon: "user",
      order: 4,
    },
  }),
  from: createTenantConfig("text", {
    required: true,
    default: "",
    write: tenantAdminWrite,
    read: tenantAdminRead,
    mask: {
      title: "mail-transport-smtp.from",
      description: "mail-transport-smtp.from.description",
      icon: "mail",
      order: 5,
    },
  }),
};
