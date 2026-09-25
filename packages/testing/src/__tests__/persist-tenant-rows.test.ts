import { describe, expect, test } from "bun:test";
import { verifyPassword } from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
import { TenantHandlers } from "@cosmicdrift/kumiko-bundled-features/tenant";
import { UserHandlers } from "@cosmicdrift/kumiko-bundled-features/user";
import { persistTenantRows, type SeedWriter } from "../seed-tenant";

type Call = { readonly handlerQn: string; readonly payload: Record<string, unknown> };

function recordingWriter(): { write: SeedWriter; calls: Call[] } {
  const calls: Call[] = [];
  const write: SeedWriter = async (handlerQn, payload) => {
    calls.push({ handlerQn, payload: payload as Record<string, unknown> }); // @cast-boundary engine-payload
    return { id: crypto.randomUUID(), data: { version: 1 } };
  };
  return { write, calls };
}

describe("persistTenantRows", () => {
  test("writes tenant, then per user create, verify and membership, through the given writer only", async () => {
    const { write, calls } = recordingWriter();

    const tenant = await persistTenantRows(write, { name: "core gmbh", users: 1 });

    expect(calls.map((call) => call.handlerQn)).toEqual([
      TenantHandlers.create,
      UserHandlers.create,
      UserHandlers.update,
      TenantHandlers.addMember,
      UserHandlers.create,
      UserHandlers.update,
      TenantHandlers.addMember,
    ]);
    expect(tenant.name).toBe("core gmbh");
    expect(tenant.members).toHaveLength(1);
    expect(calls[0]?.payload).toMatchObject({ id: tenant.id, key: tenant.key, name: "core gmbh" });
  });

  test("returns plaintext credentials while only the hash reaches the writer", async () => {
    const { write, calls } = recordingWriter();

    const tenant = await persistTenantRows(write);

    const created = calls.find((call) => call.handlerQn === UserHandlers.create);
    const hash = String(created?.payload["passwordHash"]);
    expect(hash).not.toContain(tenant.admin.password);
    expect(await verifyPassword(hash, tenant.admin.password)).toBe(true);
    expect(JSON.stringify(calls)).not.toContain(tenant.admin.password);
  });

  test("assigns TenantAdmin to the admin and Member to the others", async () => {
    const { write, calls } = recordingWriter();

    await persistTenantRows(write, { users: 2 });

    const roles = calls
      .filter((call) => call.handlerQn === TenantHandlers.addMember)
      .map((call) => call.payload["roles"]);
    expect(roles).toEqual([["TenantAdmin"], ["Member"], ["Member"]]);
  });

  test("admin identity: displayName is used as-is, email substitutes {tenantId}", async () => {
    const { write, calls } = recordingWriter();

    const tenant = await persistTenantRows(write, {
      admin: { displayName: "Demo Admin", email: "admin+{tenantId}@example.test" },
    });

    expect(tenant.admin.email).toBe(`admin+${tenant.id}@example.test`);
    const created = calls.find((call) => call.handlerQn === UserHandlers.create);
    expect(created?.payload["displayName"]).toBe("Demo Admin");
    expect(created?.payload["email"]).toBe(`admin+${tenant.id}@example.test`);
  });

  test("a failing writer aborts with its error and creates no further rows", async () => {
    const calls: string[] = [];
    const write: SeedWriter = async (handlerQn) => {
      calls.push(handlerQn);
      throw new Error(`boom in ${handlerQn}`);
    };

    await expect(persistTenantRows(write)).rejects.toThrow(/boom in tenant:write:create/);
    expect(calls).toEqual([TenantHandlers.create]);
  });
});
