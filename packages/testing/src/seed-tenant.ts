import { randomUUID } from "node:crypto";
import { hashPassword } from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
import { TenantHandlers } from "@cosmicdrift/kumiko-bundled-features/tenant";
import { UserHandlers } from "@cosmicdrift/kumiko-bundled-features/user";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import {
  createSystemUser,
  type SessionUser,
  type TenantId,
  type WriteResult,
} from "@cosmicdrift/kumiko-framework/engine";
import type { TestStack } from "@cosmicdrift/kumiko-framework/stack";
import { isPlainObject } from "@cosmicdrift/kumiko-framework/utils";
import {
  type BoundApi,
  type SeedAdminIdentity,
  type SeededCredentials,
  type SeededTenant,
  type SeedTenantOptions,
  splitSeedRoles,
  withSession,
} from "./seed-types";

export type {
  BoundApi,
  SeedAdminIdentity,
  SeededCredentials,
  SeededTenant,
  SeededUser,
  SeedPart,
  SeedTenantOptions,
} from "./seed-types";

export type SavedRow = { readonly id: string; readonly data: { readonly version: number } };

export type SeedWriter = (
  handlerQn: string,
  payload: unknown,
  tenantId: TenantId,
) => Promise<SavedRow>;

export type PersistedTenant = {
  readonly id: TenantId;
  readonly key: string;
  readonly name: string;
  readonly admin: SeededCredentials;
  readonly members: readonly SeededCredentials[];
};

function bindApi(stack: TestStack, user: SessionUser): BoundApi {
  const { http } = stack;
  return {
    writeOk: (type, payload, requestId) => http.writeOk(type, payload, user, requestId),
    writeErr: (type, payload) => http.writeErr(type, payload, user),
    queryOk: (type, payload) => http.queryOk(type, payload, user),
    queryErr: (type, payload) => http.queryErr(type, payload, user),
  };
}

function lightCredentials(email?: string): SeededCredentials {
  const id = randomUUID();
  const resolvedEmail = email ?? `user-${id}@example.test`;
  return { id, email: resolvedEmail, password: `pw-${randomUUID()}` };
}

function substituteTenantId(email: string, tenantId: string): string {
  return email.replaceAll("{tenantId}", tenantId);
}

function newTenantIdentity(name: string | undefined): {
  id: TenantId;
  key: string;
  name: string;
} {
  const id: TenantId = randomUUID();
  return { id, key: `t-${id}`, name: name ?? `Test Tenant ${id.slice(0, 8)}` };
}

function isSavedRow(value: unknown): value is SavedRow {
  if (!isPlainObject(value) || typeof value["id"] !== "string") return false;
  const data = value["data"];
  return isPlainObject(data) && typeof data["version"] === "number";
}

export function unwrapWriteData(handlerQn: string, result: WriteResult): unknown {
  if (!result.isSuccess) {
    throw new Error(`seedTenant: ${handlerQn} failed: ${JSON.stringify(result.error)}`);
  }
  return result.data;
}

export function unwrapSavedRow(handlerQn: string, result: WriteResult): SavedRow {
  const data = unwrapWriteData(handlerQn, result);
  if (!isSavedRow(data)) {
    throw new Error(`seedTenant: ${handlerQn} returned no saved row`);
  }
  return data;
}

export function stackSeedWriter(stack: TestStack): SeedWriter {
  return async (handlerQn, payload, tenantId) =>
    unwrapSavedRow(
      handlerQn,
      await stack.dispatcher.write(
        handlerQn,
        payload,
        createSystemUser(tenantId, [ROLES.SystemAdmin]),
      ),
    );
}

export async function persistUserRows(
  write: SeedWriter,
  tenantId: TenantId,
  roles: readonly string[],
  identity: SeedAdminIdentity = {},
): Promise<SeededCredentials> {
  const light = lightCredentials(
    identity.email !== undefined ? substituteTenantId(identity.email, tenantId) : undefined,
  );
  const { globalRoles, membershipRoles } = splitSeedRoles(roles);
  const created = await write(
    UserHandlers.create,
    {
      email: light.email,
      passwordHash: await hashPassword(light.password),
      displayName: identity.displayName ?? `Seed ${light.id.slice(0, 8)}`,
      ...(globalRoles.length > 0 ? { roles: [...globalRoles] } : {}),
    },
    tenantId,
  );
  await write(
    UserHandlers.update,
    { id: created.id, version: created.data.version, changes: { emailVerified: true } },
    tenantId,
  );
  await write(
    TenantHandlers.addMember,
    { userId: created.id, tenantId, roles: membershipRoles },
    tenantId,
  );
  return { id: created.id, email: light.email, password: light.password };
}

export async function persistTenantRows(
  write: SeedWriter,
  opts: {
    readonly name?: string;
    readonly users?: number;
    readonly admin?: SeedAdminIdentity;
  } = {},
): Promise<PersistedTenant> {
  const { id, key, name } = newTenantIdentity(opts.name);
  await write(TenantHandlers.create, { id, key, name }, id);
  const admin = await persistUserRows(write, id, [ROLES.TenantAdmin], opts.admin);
  const members: SeededCredentials[] = [];
  for (let i = 0; i < (opts.users ?? 0); i++) {
    members.push(await persistUserRows(write, id, [ROLES.Member]));
  }
  return { id, key, name, admin, members };
}

function lightTenantRows(opts: SeedTenantOptions): PersistedTenant {
  const identity = newTenantIdentity(opts.name);
  const members = Array.from({ length: opts.users ?? 0 }, () => lightCredentials());
  const adminEmail =
    opts.admin?.email !== undefined ? substituteTenantId(opts.admin.email, identity.id) : undefined;
  return { ...identity, admin: lightCredentials(adminEmail), members };
}

export async function seedTenant(
  stack: TestStack,
  opts: SeedTenantOptions = {},
): Promise<SeededTenant> {
  const write = stackSeedWriter(stack);
  const persist = opts.persist === true;
  const rows = persist ? await persistTenantRows(write, opts) : lightTenantRows(opts);
  const { id } = rows;

  const admin = withSession(rows.admin, id, [ROLES.TenantAdmin]);
  const tenant: SeededTenant = {
    id,
    key: rows.key,
    name: rows.name,
    admin,
    members: rows.members.map((member) => withSession(member, id, [ROLES.Member])),
    addUser: async (roles = [ROLES.Member], identity = {}) =>
      withSession(
        persist
          ? await persistUserRows(write, id, roles, identity)
          : lightCredentials(
              identity.email !== undefined ? substituteTenantId(identity.email, id) : undefined,
            ),
        id,
        roles,
      ),
    api: bindApi(stack, admin.session),
    apiAs: (user) => bindApi(stack, user.session),
  };

  for (const part of opts.with ?? []) await part({ tenant });
  return tenant;
}
