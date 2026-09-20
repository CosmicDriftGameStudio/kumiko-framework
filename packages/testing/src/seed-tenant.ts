import { randomUUID } from "node:crypto";
import { hashPassword } from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
import { TenantHandlers } from "@cosmicdrift/kumiko-bundled-features/tenant";
import { UserHandlers } from "@cosmicdrift/kumiko-bundled-features/user";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import {
  createSystemUser,
  type SessionUser,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import type { WriteErrorInfo } from "@cosmicdrift/kumiko-framework/errors";
import type { TestStack } from "@cosmicdrift/kumiko-framework/stack";
import { isPlainObject } from "@cosmicdrift/kumiko-framework/utils";

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

export type SeededUser = {
  readonly id: string;
  readonly email: string;
  readonly password: string;
  readonly session: SessionUser;
};

export type SeedPart = (ctx: {
  readonly stack: TestStack;
  readonly tenant: SeededTenant;
}) => Promise<void>;

export type SeedTenantOptions = {
  readonly name?: string;
  readonly users?: number;
  readonly with?: readonly SeedPart[];
  readonly persist?: boolean;
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

function bindApi(stack: TestStack, user: SessionUser): BoundApi {
  const { http } = stack;
  return {
    writeOk: (type, payload, requestId) => http.writeOk(type, payload, user, requestId),
    writeErr: (type, payload) => http.writeErr(type, payload, user),
    queryOk: (type, payload) => http.queryOk(type, payload, user),
    queryErr: (type, payload) => http.queryErr(type, payload, user),
  };
}

function lightUser(tenantId: TenantId, roles: readonly string[]): SeededUser {
  const id = randomUUID();
  return {
    id,
    email: `user-${id}@example.test`,
    password: `pw-${randomUUID()}`,
    session: { id, tenantId, roles },
  };
}

type SavedRow = { readonly id: string; readonly data: { readonly version: number } };

function isSavedRow(value: unknown): value is SavedRow {
  if (!isPlainObject(value) || typeof value["id"] !== "string") return false;
  const data = value["data"];
  return isPlainObject(data) && typeof data["version"] === "number";
}

async function dispatchSeedWrite(
  stack: TestStack,
  type: string,
  payload: unknown,
  actor: SessionUser,
): Promise<SavedRow> {
  const result = await stack.dispatcher.write(type, payload, actor);
  if (!result.isSuccess) {
    throw new Error(`seedTenant: ${type} failed: ${JSON.stringify(result.error)}`);
  }
  if (!isSavedRow(result.data)) {
    throw new Error(`seedTenant: ${type} returned no saved row`);
  }
  return result.data;
}

async function persistUser(
  stack: TestStack,
  tenantId: TenantId,
  roles: readonly string[],
): Promise<SeededUser> {
  const user = lightUser(tenantId, roles);
  const operator = createSystemUser(tenantId, [ROLES.SystemAdmin]);
  const created = await dispatchSeedWrite(
    stack,
    UserHandlers.create,
    {
      email: user.email,
      passwordHash: await hashPassword(user.password),
      displayName: `Seed ${user.id.slice(0, 8)}`,
    },
    operator,
  );
  await dispatchSeedWrite(
    stack,
    UserHandlers.update,
    { id: created.id, version: created.data.version, changes: { emailVerified: true } },
    operator,
  );
  await dispatchSeedWrite(
    stack,
    TenantHandlers.addMember,
    { userId: created.id, tenantId, roles },
    operator,
  );
  return { ...user, id: created.id, session: { ...user.session, id: created.id } };
}

export async function seedTenant(
  stack: TestStack,
  opts: SeedTenantOptions = {},
): Promise<SeededTenant> {
  const id: TenantId = randomUUID();
  const key = `t-${id}`;
  const name = opts.name ?? `Test Tenant ${id.slice(0, 8)}`;
  const persist = opts.persist === true;

  if (persist) {
    await dispatchSeedWrite(
      stack,
      TenantHandlers.create,
      { id, key, name },
      createSystemUser(id, [ROLES.SystemAdmin]),
    );
  }

  const createUser = (roles: readonly string[]): Promise<SeededUser> =>
    persist ? persistUser(stack, id, roles) : Promise.resolve(lightUser(id, roles));

  const admin = await createUser([ROLES.TenantAdmin]);
  const members: SeededUser[] = [];
  for (let i = 0; i < (opts.users ?? 0); i++) members.push(await createUser([ROLES.Member]));

  const tenant: SeededTenant = {
    id,
    key,
    name,
    admin,
    members,
    addUser: (roles = [ROLES.Member]) => createUser(roles),
    api: bindApi(stack, admin.session),
    apiAs: (user) => bindApi(stack, user.session),
  };

  for (const part of opts.with ?? []) await part({ stack, tenant });
  return tenant;
}
