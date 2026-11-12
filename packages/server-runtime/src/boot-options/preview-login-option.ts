import { USER_STATUS, UserQueries } from "@cosmicdrift/kumiko-bundled-features/user";
import type { AuthRoutesConfig } from "@cosmicdrift/kumiko-framework/api";
import {
  buildSessionRoles,
  createSystemUser,
  SYSTEM_TENANT_ID,
  TENANT_MEMBERSHIPS_QUERY,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { KumikoBootError } from "@cosmicdrift/kumiko-framework/env";
import { parseRoles } from "@cosmicdrift/kumiko-framework/utils";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";

/** Studio preview login: a signed, short-lived link signs the app owner in. Off when unset or loginKey is empty. */
export type PreviewLoginOption = { readonly loginKey: string };

type PreviewLoginConfig = NonNullable<AuthRoutesConfig["previewLogin"]>;

const MIN_LOGIN_KEY_LENGTH = 32;

function isMembership(value: unknown): value is { readonly tenantId: TenantId } {
  return isPlainObject(value) && typeof value["tenantId"] === "string";
}

/** Empty key means "off"; a non-empty key shorter than the minimum is a boot error. */
export function assertPreviewLoginKey(option: PreviewLoginOption | undefined): void {
  if (option === undefined || option.loginKey === "") return;
  if (option.loginKey.length < MIN_LOGIN_KEY_LENGTH) {
    throw new KumikoBootError([
      {
        name: "previewLogin.loginKey",
        kind: "invalid",
        message: `previewLogin.loginKey must be at least ${MIN_LOGIN_KEY_LENGTH} characters (use 64 hex chars from a CSPRNG).`,
      },
    ]);
  }
}

export function buildPreviewLoginConfig(
  option: PreviewLoginOption | undefined,
  ownerEmail: string | undefined,
): PreviewLoginConfig | undefined {
  assertPreviewLoginKey(option);
  if (option === undefined || option.loginKey === "") return undefined;
  return {
    loginKey: option.loginKey,
    resolveOwnerSession: async (dispatcher) => {
      if (ownerEmail === undefined || ownerEmail === "") return undefined;
      const system = createSystemUser(SYSTEM_TENANT_ID);
      const row = await dispatcher.query(UserQueries.findForAuth, { email: ownerEmail }, system);
      if (!isPlainObject(row) || typeof row["id"] !== "string" || row["isDeleted"] === true) {
        return undefined;
      }
      if (
        row["status"] === USER_STATUS.Restricted ||
        row["status"] === USER_STATUS.DeletionRequested ||
        row["status"] === USER_STATUS.Deleted
      ) {
        return undefined;
      }
      const userId = row["id"];
      const memberships = await dispatcher.query(TENANT_MEMBERSHIPS_QUERY, { userId }, system);
      if (!Array.isArray(memberships)) return undefined;
      const lastActive = row["lastActiveTenantId"];
      const candidates = memberships.filter(isMembership);
      const ordered = [
        ...candidates.filter((m) => m.tenantId === lastActive),
        ...candidates.filter((m) => m.tenantId !== lastActive),
      ];
      for (const candidate of ordered) {
        const active = await dispatcher.resolveActiveMembership(userId, candidate.tenantId);
        if (active.kind === "rejected") continue;
        return {
          id: userId,
          tenantId: active.membership.tenantId,
          roles: buildSessionRoles(parseRoles(row["roles"] ?? null), active.membership.roles),
        };
      }
      return undefined;
    },
  };
}
