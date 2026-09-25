import type { SessionUser, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import type { WriteErrorInfo } from "@cosmicdrift/kumiko-framework/errors";

export type BoundApi = {
  writeOk: <T = Record<string, unknown>>(
    type: string,
    payload: unknown,
    requestId?: string,
  ) => Promise<T>;
  writeErr: (type: string, payload: unknown) => Promise<WriteErrorInfo>;
  queryOk: <T = unknown>(type: string, payload: unknown) => Promise<T>;
  queryErr: (type: string, payload: unknown) => Promise<WriteErrorInfo>;
};

export type SeededCredentials = {
  readonly id: string;
  readonly email: string;
  readonly password: string;
};

export type SeededUser = SeededCredentials & { readonly session: SessionUser };

export type SeedPart = (ctx: { readonly tenant: SeededTenant }) => Promise<void>;

// email may contain the literal "{tenantId}" placeholder, substituted with the
// seeded tenant's id — user:create's email uniqueness is global (fw#2134/#2593),
// so a fixed literal email collides across per-scenario tenants.
export type SeedAdminIdentity = {
  readonly displayName?: string;
  readonly email?: string;
};

export type SeedTenantOptions = {
  readonly name?: string;
  readonly users?: number;
  readonly with?: readonly SeedPart[];
  readonly persist?: boolean;
  readonly admin?: SeedAdminIdentity;
};

export type SeededTenant = {
  readonly id: TenantId;
  readonly key: string;
  readonly name: string;
  readonly admin: SeededUser;
  readonly members: readonly SeededUser[];
  readonly addUser: (roles?: readonly string[]) => Promise<SeededUser>;
  readonly api: BoundApi;
  readonly apiAs: (user: SeededUser) => BoundApi;
};

export function withSession(
  credentials: SeededCredentials,
  tenantId: TenantId,
  roles: readonly string[],
): SeededUser {
  return { ...credentials, session: { id: credentials.id, tenantId, roles } };
}
