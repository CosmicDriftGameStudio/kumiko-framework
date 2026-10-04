import { describe, expect, test } from "bun:test";
import type {
  ChannelContext,
  ChannelMessage,
  NotificationRenderer,
  RenderedMessage,
} from "../../delivery/index.js";
import { createEmailChannel } from "../email-channel.js";
import { createInMemoryTransport } from "../types.js";

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

  test("fromName from channel data reaches the transport", async () => {
    const transport = createInMemoryTransport();
    const message: ChannelMessage = {
      notificationType: "x",
      title: "t",
      body: "b",
      data: { subject: "t", body: "b", fromName: "Tenant via veridom" },
    };
    await channelWith(transport).send("mieter@example.com", message, ctx, rendered);
    expect(transport.sent[0]?.fromName).toBe("Tenant via veridom");
    expect(transport.sent[0]?.from).toBeUndefined();
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

  test("non-string header values are filtered out", async () => {
    const transport = createInMemoryTransport();
    const message: ChannelMessage = {
      notificationType: "x",
      title: "t",
      body: "b",
      data: {
        subject: "t",
        body: "b",
        headers: { "X-Ok": "v", "X-Bad": 42 },
      },
    };
    await channelWith(transport).send("mieter@example.com", message, ctx, rendered);

    const [sent] = transport.sent;
    if (!sent) throw new Error("expected a sent mail");
    expect(sent.headers).toEqual({ "X-Ok": "v" });
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

describe("email channel List-Unsubscribe headers", () => {
  test("unsubscribeUrl on the framework route sets both headers", async () => {
    const transport = createInMemoryTransport();
    const unsubscribeUrl = "https://app.example/api/delivery/unsubscribe?token=abc";
    const message: ChannelMessage = {
      notificationType: "x",
      title: "t",
      body: "b",
      data: { subject: "t", body: "b", unsubscribeUrl },
    };
    await channelWith(transport).send("mieter@example.com", message, ctx, rendered);

    const [sent] = transport.sent;
    if (!sent) throw new Error("expected a sent mail");
    expect(sent.headers).toEqual({
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  test("unsubscribeUrl on a foreign path sets no headers", async () => {
    const transport = createInMemoryTransport();
    const message: ChannelMessage = {
      notificationType: "x",
      title: "t",
      body: "b",
      data: {
        subject: "t",
        body: "b",
        unsubscribeUrl: "https://app.example/subscribe/unsubscribe?token=abc",
      },
    };
    await channelWith(transport).send("mieter@example.com", message, ctx, rendered);

    const [sent] = transport.sent;
    if (!sent) throw new Error("expected a sent mail");
    expect(sent.headers).toBeUndefined();
  });

  test("an unparseable unsubscribeUrl sets no headers", async () => {
    const transport = createInMemoryTransport();
    const message: ChannelMessage = {
      notificationType: "x",
      title: "t",
      body: "b",
      data: { subject: "t", body: "b", unsubscribeUrl: "not a url" },
    };
    await channelWith(transport).send("mieter@example.com", message, ctx, rendered);

    const [sent] = transport.sent;
    if (!sent) throw new Error("expected a sent mail");
    expect(sent.headers).toBeUndefined();
  });

  test("no unsubscribeUrl sets no headers", async () => {
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
    expect(sent.headers).toBeUndefined();
  });

  const unsubscribeUrl = "https://app.example/api/delivery/unsubscribe?token=abc";

  async function sendWithHeaders(headers: Record<string, string>) {
    const transport = createInMemoryTransport();
    const message: ChannelMessage = {
      notificationType: "x",
      title: "t",
      body: "b",
      data: { subject: "t", body: "b", unsubscribeUrl, headers },
    };
    await channelWith(transport).send("mieter@example.com", message, ctx, rendered);
    const [sent] = transport.sent;
    if (!sent) throw new Error("expected a sent mail");
    return sent;
  }

  test("overriding List-Unsubscribe alone drops the auto one-click Post header", async () => {
    const sent = await sendWithHeaders({ "List-Unsubscribe": "<mailto:override@example.com>" });
    expect(sent.headers).toEqual({ "List-Unsubscribe": "<mailto:override@example.com>" });
  });

  test("a lowercase override replaces the auto pair instead of duplicating it", async () => {
    const sent = await sendWithHeaders({ "list-unsubscribe": "<mailto:override@example.com>" });
    expect(sent.headers).toEqual({ "list-unsubscribe": "<mailto:override@example.com>" });
  });
});

describe("email channel text part", () => {
  const message: ChannelMessage = {
    notificationType: "x",
    title: "Hallo",
    body: "Dein Code ist 1234.",
    data: undefined,
  };

  test("a renderer with renderText puts its output into the rendered message and the mail", async () => {
    const transport = createInMemoryTransport();
    const channel = createEmailChannel({
      transport,
      renderer: { ...stubRenderer, renderText: async () => "rendered as text" },
      resolveEmail,
    });
    const renderedMessage = await channel.render?.(message, ctx);
    expect(renderedMessage?.text).toBe("rendered as text");
    await channel.send("user@example.com", message, ctx, renderedMessage);
    expect(transport.sent[0]?.text).toBe("rendered as text");
  });

  test("a renderer without renderText sends html only", async () => {
    const transport = createInMemoryTransport();
    await channelWith(transport).send("user@example.com", message, ctx);
    expect(transport.sent[0]?.html).toBe("<p>rendered</p>");
    expect(transport.sent[0]).not.toHaveProperty("text");
  });
});
