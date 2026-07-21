import { beforeEach, describe, expect, test } from "bun:test";
import type { EmailMessage } from "@cosmicdrift/kumiko-bundled-features/channel-email";
import type { MailTransportContext, MailTransportPlugin } from "../feature";

export type MailTransportContractFixture = {
  readonly plugin: MailTransportPlugin;
  readonly ctx: MailTransportContext;
  readonly tenantId: string;
  // Local providers (inmemory) expose readBack to assert real delivery;
  // remote providers (smtp) omit it — send() needs a live server.
  readonly readBack?: (tenantId: string) => readonly EmailMessage[];
};

export function describeMailTransportContract(
  name: string,
  factory: () => MailTransportContractFixture | Promise<MailTransportContractFixture>,
): void {
  describe(`${name} — MailTransportPlugin contract`, () => {
    let fixture: MailTransportContractFixture;

    beforeEach(async () => {
      fixture = await factory();
    });

    test("build resolves to an EmailTransport with a send function", async () => {
      const transport = await fixture.plugin.build(fixture.ctx, fixture.tenantId);
      expect(typeof transport.send).toBe("function");
    });

    test("send delivers the message — verified via readBack", async () => {
      if (!fixture.readBack) return;
      const message: EmailMessage = {
        to: "contract-recipient@example.test",
        subject: "contract-test-subject",
        html: "<p>contract-test-body</p>",
      };
      const transport = await fixture.plugin.build(fixture.ctx, fixture.tenantId);
      await transport.send(message);
      expect(fixture.readBack(fixture.tenantId)).toContainEqual(message);
    });
  });
}
