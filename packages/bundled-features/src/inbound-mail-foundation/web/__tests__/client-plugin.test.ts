import { describe, expect, test } from "bun:test";
import { INBOUND_MAIL_RECONNECT_OAUTH_ACTION } from "../../constants.ts";
import { inboundMailFoundationClient } from "../client-plugin.ts";

function reconnectWith(connectPath?: string) {
  const visited: string[] = [];
  const client = inboundMailFoundationClient({
    navigate: (url) => visited.push(url),
    ...(connectPath && { connectPath }),
  });
  const handler = client.clientActions?.[INBOUND_MAIL_RECONNECT_OAUTH_ACTION];
  if (handler === undefined) throw new Error("reconnect action is not registered");
  return { handler, visited };
}

describe("OAuth reconnect client action", () => {
  test("a personal mailbox signs in again through the connect route as the caller's own mailbox", async () => {
    const { handler, visited } = reconnectWith();

    const outcome = await handler({
      provider: "m365-graph",
      address: "ada+inbox@example.com",
      ownerUserId: "6b2f4a0e-1c9d-4f3a-9d2e-00000000000a",
    });

    expect(outcome).toEqual({ ok: true });
    expect(visited).toEqual([
      "/api/inbound-mail/connect?provider=m365-graph&scope=user&mailbox=ada%2Binbox%40example.com",
    ]);
  });

  test("a shared mailbox signs in again as shared, on the app's own connect path", async () => {
    const { handler, visited } = reconnectWith("/api/mail/connect");

    await handler({ provider: "gmail-rest", address: "info@example.com", ownerUserId: null });

    expect(visited).toEqual([
      "/api/mail/connect?provider=gmail-rest&scope=shared&mailbox=info%40example.com",
    ]);
  });

  test.each([[{}], [{ provider: "gmail-rest" }], [{ provider: "", address: "info@example.com" }]])(
    "a row without provider or address %p does not leave the app",
    async (payload) => {
      const { handler, visited } = reconnectWith();

      const outcome = await handler(payload);

      expect(outcome).toEqual({ ok: false, message: "inboundMail.accounts.reconnect.invalidRow" });
      expect(visited).toEqual([]);
    },
  );
});
