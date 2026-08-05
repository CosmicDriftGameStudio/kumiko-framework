import { describe, expect, test } from "bun:test";
import type {
  ChannelContext,
  ChannelMessage,
  NotificationRenderer,
  RenderedMessage,
} from "../../delivery";
import { createEmailChannel } from "../email-channel";
import { createInMemoryTransport } from "../types";

const stubRenderer: NotificationRenderer = {
  name: "stub",
  render: async () => "<p>rendered</p>",
};
const resolveEmail = async () => "user@example.com";
// send() never touches ctx — only render()/resolve() would, and this test
// passes `rendered` so render() is skipped.
const ctx = {} as unknown as ChannelContext;
const rendered: RenderedMessage = { html: "<p>x</p>", subject: "Re: Wasserschaden" };

function channelWith(transport: ReturnType<typeof createInMemoryTransport>) {
  return createEmailChannel({ transport, renderer: stubRenderer, resolveEmail });
}

describe("email channel envelope", () => {
  test("from / replyTo / headers from channel data reach the transport", async () => {
    const transport = createInMemoryTransport();
    const message: ChannelMessage = {
      notificationType: "inbound-reply-sent",
      title: "Re: Wasserschaden",
      body: "Danke für Ihre Nachricht.",
      data: {
        subject: "Re: Wasserschaden",
        body: "Danke für Ihre Nachricht.",
        from: "verwaltung@haus.de",
        replyTo: "verwaltung@haus.de",
        headers: { "In-Reply-To": "<abc@mail>", References: "<abc@mail>" },
      },
    };
    await channelWith(transport).send("mieter@example.com", message, ctx, rendered);

    expect(transport.sent).toHaveLength(1);
    const [sent] = transport.sent;
    if (!sent) throw new Error("expected a sent mail");
    expect(sent.to).toBe("mieter@example.com");
    expect(sent.from).toBe("verwaltung@haus.de");
    expect(sent.replyTo).toBe("verwaltung@haus.de");
    expect(sent.headers).toEqual({ "In-Reply-To": "<abc@mail>", References: "<abc@mail>" });
  });

  test("no envelope keys → transport gets none and falls back to its default From", async () => {
    const transport = createInMemoryTransport();
    const message: ChannelMessage = {
      notificationType: "x",
      title: "t",
      body: "b",
      data: { subject: "t", body: "b" },
    };
    await channelWith(transport).send("mieter@example.com", message, ctx, rendered);

    const [sent] = transport.sent;
    if (!sent) throw new Error("expected a sent mail");
    expect(sent.from).toBeUndefined();
    expect(sent.replyTo).toBeUndefined();
    expect(sent.headers).toBeUndefined();
  });

  test("a non-object headers value is ignored, not forwarded", async () => {
    const transport = createInMemoryTransport();
    const message: ChannelMessage = {
      notificationType: "x",
      title: "t",
      body: "b",
      data: { subject: "t", body: "b", from: 42, headers: "not-an-object" },
    };
    await channelWith(transport).send("mieter@example.com", message, ctx, rendered);

    const [sent] = transport.sent;
    if (!sent) throw new Error("expected a sent mail");
    expect(sent.from).toBeUndefined();
    expect(sent.headers).toBeUndefined();
  });
});
