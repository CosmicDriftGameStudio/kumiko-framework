import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { helpdeskFeature } from "../feature";

type TicketRow = { id: string; title: string; isClosed: boolean };

let stack: TestStack;
let nextTenant = 1;
let admin = createTestUser({ roles: ["Admin"], tenantId: testTenantId(nextTenant) });
let agent = createTestUser({ id: 2, roles: ["User"], tenantId: testTenantId(nextTenant) });

beforeAll(async () => {
  stack = await setupTestStack({ features: [helpdeskFeature], systemHooks: [] });
});

afterAll(async () => {
  await stack.cleanup();
});

// A fresh tenant per test keeps rows from other tests out of every list.
beforeEach(() => {
  nextTenant += 1;
  admin = createTestUser({ roles: ["Admin"], tenantId: testTenantId(nextTenant) });
  agent = createTestUser({ id: 2, roles: ["User"], tenantId: testTenantId(nextTenant) });
});

async function openTicket(title: string): Promise<string> {
  const created = await stack.http.writeOk<{ id: string }>(
    "helpdesk:write:ticket:create",
    { title },
    agent,
  );
  return created.id;
}

async function readTicket(id: string): Promise<TicketRow> {
  return stack.http.queryOk<TicketRow>("helpdesk:query:ticket:detail", { id }, agent);
}

describe("golden path: ticket", () => {
  test("a new ticket starts open", async () => {
    const id = await openTicket("Printer is on fire");

    expect(await readTicket(id)).toMatchObject({ title: "Printer is on fire", isClosed: false });
  });

  test("closing a ticket emits an event that the projection folds into the read model", async () => {
    const id = await openTicket("Login fails");

    await stack.http.writeOk(
      "helpdesk:write:ticket:close",
      { id, resolution: "Password reset" },
      admin,
    );

    expect(await readTicket(id)).toMatchObject({ title: "Login fails", isClosed: true });
    const list = await stack.http.queryOk<{ rows: TicketRow[] }>(
      "helpdesk:query:ticket:list",
      { filter: { field: "isClosed", op: "eq", value: true } },
      agent,
    );
    expect(list.rows.map((row) => row.id)).toEqual([id]);
  });

  test("only an Admin may close a ticket", async () => {
    const id = await openTicket("Slow wifi");

    const denied = await stack.http.writeErr(
      "helpdesk:write:ticket:close",
      { id, resolution: "Moved the router" },
      agent,
    );

    expect(denied.code).toBe("access_denied");
    expect((await readTicket(id)).isClosed).toBe(false);
  });

  test("closing an unknown ticket fails with not_found", async () => {
    const missing = await stack.http.writeErr(
      "helpdesk:write:ticket:close",
      { id: "99999999-9999-4999-8999-999999999999", resolution: "n/a" },
      admin,
    );

    expect(missing.code).toBe("not_found");
  });
});
