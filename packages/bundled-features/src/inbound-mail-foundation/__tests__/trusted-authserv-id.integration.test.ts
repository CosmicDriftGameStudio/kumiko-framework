// The trusted authserv-id decides whose Authentication-Results header the sender check believes, so
// it only changes through set-trusted-authserv-id; the generic account handlers refuse the field.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import { InboundMailFoundationHandlers, mailAccountsProjectionTable } from "../index.ts";
import {
  adminFor,
  connectInMemoryAccount,
  type MailTestStack,
  setupMailStack,
} from "./mail-test-support.ts";

let env: MailTestStack;

beforeAll(async () => {
  env = await setupMailStack({ withFiles: false });
});

afterAll(async () => {
  await env.stack.cleanup();
  resetPiiSubjectKmsForTests();
});

async function storedTrustedId(accountId: string): Promise<unknown> {
  const [row] = await selectMany(env.stack.db, mailAccountsProjectionTable, { id: accountId });
  return row?.["trustedAuthservId"];
}

describe("trustedAuthservId only through its own handler", () => {
  test("connect-account and update-account refuse the field", async () => {
    const admin = adminFor(6601);
    const connectErr = await env.stack.http.writeErr(
      InboundMailFoundationHandlers.connectAccount,
      {
        provider: "inmemory",
        authMethod: "password",
        displayName: "Team",
        address: "forged@tenant.example",
        scope: "shared",
        trustedAuthservId: "mx.attacker.example",
      },
      admin,
    );
    expect(connectErr.httpStatus).toBe(400);

    const accountId = await connectInMemoryAccount(env.stack, admin);
    const updateErr = await env.stack.http.writeErr(
      InboundMailFoundationHandlers.updateAccount,
      { accountId, trustedAuthservId: "mx.attacker.example" },
      admin,
    );
    expect(updateErr.httpStatus).toBe(400);
    expect(await storedTrustedId(accountId)).toBeNull();
  });

  test("set-trusted-authserv-id sets, normalizes, keeps and clears the value", async () => {
    const admin = adminFor(6602);
    const accountId = await connectInMemoryAccount(env.stack, admin);

    const set = await env.stack.http.writeOk<{ changed: boolean }>(
      InboundMailFoundationHandlers.setTrustedAuthservId,
      { accountId, trustedAuthservId: " MX.Tenant.Example " },
      admin,
    );
    expect(set.changed).toBe(true);
    expect(await storedTrustedId(accountId)).toBe("mx.tenant.example");

    const same = await env.stack.http.writeOk<{ changed: boolean }>(
      InboundMailFoundationHandlers.setTrustedAuthservId,
      { accountId, trustedAuthservId: "mx.tenant.example" },
      admin,
    );
    expect(same.changed).toBe(false);

    const cleared = await env.stack.http.writeOk<{ changed: boolean }>(
      InboundMailFoundationHandlers.setTrustedAuthservId,
      { accountId, trustedAuthservId: null },
      admin,
    );
    expect(cleared.changed).toBe(true);
    expect(await storedTrustedId(accountId)).toBeNull();
  });

  test("a disconnected mailbox is refused", async () => {
    const admin = adminFor(6603);
    const accountId = await connectInMemoryAccount(env.stack, admin);
    await env.stack.http.writeOk(
      InboundMailFoundationHandlers.disconnectAccount,
      { accountId },
      admin,
    );

    const error = await env.stack.http.writeErr(
      InboundMailFoundationHandlers.setTrustedAuthservId,
      { accountId, trustedAuthservId: "mx.tenant.example" },
      admin,
    );

    expect(JSON.stringify(error)).toContain("account_disconnected");
  });
});
