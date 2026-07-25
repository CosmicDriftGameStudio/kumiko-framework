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

export type MailTransportContractOptions = {
  // Local providers (inmemory) can assert real delivery via readBack —
  // remote providers (smtp) can't (send() needs a live server), so their
  // delivery test must show as an explicit `skip` in test output, not a
  // silently-passing green with zero assertions (#1334).
  readonly verifiesDelivery: boolean;
};

export function describeMailTransportContract(
  name: string,
  factory: () => MailTransportContractFixture | Promise<MailTransportContractFixture>,
  options: MailTransportContractOptions,
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

    (options.verifiesDelivery ? test : test.skip)(
      "send delivers the message — verified via readBack",
      async () => {
        if (!fixture.readBack) {
          throw new Error(
            "describeMailTransportContract: verifiesDelivery:true but the fixture has no readBack",
          );
        }
        const message: EmailMessage = {
          to: "contract-recipient@example.test",
          subject: "contract-test-subject",
          html: "<p>contract-test-body</p>",
        };
        const transport = await fixture.plugin.build(fixture.ctx, fixture.tenantId);
        await transport.send(message);
        expect(fixture.readBack(fixture.tenantId)).toContainEqual(message);
      },
    );
  });
}
