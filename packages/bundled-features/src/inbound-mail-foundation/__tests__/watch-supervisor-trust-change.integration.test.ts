// A running watch keeps the account it was started with. When the mailbox's trusted authserv-id
// changes, the next tick must start a fresh watch, or IDLE-delivered mail keeps the old trust.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { resetPiiSubjectKmsForTests, waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import {
  resetInboundInMemory,
  watchedTrustedAuthservIdOf,
} from "../../inbound-provider-inmemory/index.ts";
import { InboundMailFoundationHandlers } from "../index.ts";
import {
  adminFor,
  connectInMemoryAccount,
  createMailSupervisor,
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

beforeEach(() => {
  resetInboundInMemory();
});

describe("a changed trusted authserv-id", () => {
  let supervisor: ReturnType<typeof createMailSupervisor>;

  beforeEach(async () => {
    supervisor = createMailSupervisor(env.stack);
    await supervisor.start();
  });

  afterEach(async () => {
    await supervisor.stop();
  });

  test("restarts the running watch with the new value on the next tick", async () => {
    const admin = adminFor(6501);
    const accountId = await connectInMemoryAccount(env.stack, admin);
    await supervisor.pollOnce();
    expect(watchedTrustedAuthservIdOf(accountId)).toBeNull();

    await env.stack.http.writeOk(
      InboundMailFoundationHandlers.setTrustedAuthservId,
      { accountId, trustedAuthservId: "mx.tenant.example" },
      admin,
    );
    await supervisor.pollOnce();

    await waitFor(async () => {
      expect(watchedTrustedAuthservIdOf(accountId)).toBe("mx.tenant.example");
    });
  });
});
