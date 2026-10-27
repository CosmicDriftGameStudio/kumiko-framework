import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import type { FeatureDefinition, Registry } from "@cosmicdrift/kumiko-framework/engine";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { INBOUND_MAIL_FOUNDATION_FEATURE, InboundMailFoundationHandlers } from "./constants.ts";

export type InboundMailRoleOptions = {
  /** Roles that use their own and the shared mailboxes. Admins are always members too. */
  readonly userRoles?: readonly string[];
  /** Roles that administer shared mailboxes and see the metadata of personal ones. */
  readonly adminRoles?: readonly string[];
};

export type InboundMailRoles = {
  readonly userRoles: readonly string[];
  readonly adminRoles: readonly string[];
  /** admin ∪ user, deduplicated: everyone who may touch the mail feature at all. */
  readonly memberRoles: readonly string[];
};

export const DEFAULT_INBOUND_MAIL_USER_ROLES = ["User"] as const;
export const DEFAULT_INBOUND_MAIL_ADMIN_ROLES = [ROLES.TenantAdmin, ROLES.SystemAdmin] as const;

function validatedRoles(optionName: string, roles: readonly string[]): readonly string[] {
  if (roles.length === 0) {
    throw new Error(`createInboundMailFoundationFeature: ${optionName} must not be empty.`);
  }
  if (roles.some((role) => role.trim() === "")) {
    throw new Error(
      `createInboundMailFoundationFeature: ${optionName} must not contain empty role names.`,
    );
  }
  if (roles.includes("anonymous")) {
    throw new Error(
      `createInboundMailFoundationFeature: ${optionName} must not contain "anonymous": mail is only readable by members of the tenant.`,
    );
  }
  return [...roles];
}

// Handlers the supervisor, the account health, the OAuth callback and the refresh job dispatch as the
// system user (SystemAdmin). Every new system dispatch must target one of these; a test scans the
// sources for it.
export const SYSTEM_DISPATCHED_MAIL_HANDLERS: readonly string[] = [
  InboundMailFoundationHandlers.ingestMessage,
  InboundMailFoundationHandlers.connectAccount,
  InboundMailFoundationHandlers.updateAccount,
  InboundMailFoundationHandlers.reactivateAccount,
  InboundMailFoundationHandlers.markCredentialStored,
  InboundMailFoundationHandlers.attachMessageContent,
];

// An app whose adminRoles/memberRoles leave SystemAdmin out would see every system dispatch refused.
// Only handler access lists use this; isMailAdmin and screens keep the configured roles.
export function accessRolesOf(handlerQn: string, roles: readonly string[]): string[] {
  return SYSTEM_DISPATCHED_MAIL_HANDLERS.includes(handlerQn)
    ? [...new Set([...roles, ROLES.SystemAdmin])]
    : [...roles];
}

export function resolveInboundMailRoles(options: InboundMailRoleOptions = {}): InboundMailRoles {
  const userRoles = validatedRoles(
    "userRoles",
    options.userRoles ?? DEFAULT_INBOUND_MAIL_USER_ROLES,
  );
  const adminRoles = validatedRoles(
    "adminRoles",
    options.adminRoles ?? DEFAULT_INBOUND_MAIL_ADMIN_ROLES,
  );
  return { userRoles, adminRoles, memberRoles: [...new Set([...adminRoles, ...userRoles])] };
}

// dedupeOptions accept primitives only: equal role sets collapse, differing ones fail at boot.
export function roleDedupeOptions(roles: InboundMailRoles): Readonly<Record<string, string>> {
  return {
    userRoles: [...roles.userRoles].sort().join(","),
    adminRoles: [...roles.adminRoles].sort().join(","),
  };
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isInboundMailRoles(value: unknown): value is InboundMailRoles {
  return (
    isPlainObject(value) &&
    isStringArray(value["userRoles"]) &&
    isStringArray(value["adminRoles"]) &&
    isStringArray(value["memberRoles"])
  );
}

function inboundMailRolesOfFeature(feature: FeatureDefinition): InboundMailRoles | undefined {
  const exported = feature.exports;
  return isPlainObject(exported) && isInboundMailRoles(exported["roles"])
    ? exported["roles"]
    : undefined;
}

export function readInboundMailRoles(registry: Registry): InboundMailRoles {
  const feature = registry.features.get(INBOUND_MAIL_FOUNDATION_FEATURE);
  return (feature && inboundMailRolesOfFeature(feature)) ?? resolveInboundMailRoles();
}

function sameRoleSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((role) => b.includes(role));
}

// Provider features register forms whose dispatches the foundation's handlers answer, so roles
// that differ from the foundation's would only surface as 403s at runtime.
export function assertRolesMatchFoundation(
  featureName: string,
  roles: InboundMailRoles,
  features: readonly FeatureDefinition[],
): void {
  const foundation = features.find((feature) => feature.name === INBOUND_MAIL_FOUNDATION_FEATURE);
  const foundationRoles = foundation && inboundMailRolesOfFeature(foundation);
  if (
    foundationRoles !== undefined &&
    !(
      sameRoleSet(foundationRoles.userRoles, roles.userRoles) &&
      sameRoleSet(foundationRoles.adminRoles, roles.adminRoles)
    )
  ) {
    throw new Error(
      `${featureName}: role options differ from ${INBOUND_MAIL_FOUNDATION_FEATURE} ` +
        `(userRoles [${roles.userRoles.join(", ")}] vs [${foundationRoles.userRoles.join(", ")}], ` +
        `adminRoles [${roles.adminRoles.join(", ")}] vs [${foundationRoles.adminRoles.join(", ")}]). ` +
        `Pass the same userRoles/adminRoles to ${featureName} and ${INBOUND_MAIL_FOUNDATION_FEATURE}.`,
    );
  }
}
