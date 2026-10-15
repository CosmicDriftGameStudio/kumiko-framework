import { describe, expect, test } from "bun:test";
import { createRegistry, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import type { ChannelContext, ChannelMessage, RenderedMessage } from "../../delivery/index.js";
import { createEmailChannel, fileAttachmentsFrom } from "../email-channel.js";
import { createInMemoryTransport } from "../types.js";

const resolveEmail = async () => "user@example.com";
// send() with a `rendered` message only reads ctx.registry (to look up a
// notification template); render()/resolve() would need more.
const ctx = { registry: createRegistry([]) } as unknown as ChannelContext;
const rendered: RenderedMessage = { html: "<p>x</p>", subject: "Re: Wasserschaden" };

function channelWith(transport: ReturnType<typeof createInMemoryTransport>) {
  return createEmailChannel({ transport, resolveEmail });
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

describe("email channel template notifications", () => {
  const templated = defineFeature("tpl", (r) => {
    r.notification("welcome", {
      template: { en: { body: "<p>Hi</p>" } },
      meta: { en: { subject: "Hi" } },
    });
  });
  const message: ChannelMessage = {
    notificationType: "tpl:notify:welcome",
    title: "ignored",
    body: "ignored",
    locale: "de",
    data: { name: "Ada", unsubscribeUrl: "https://x.example/unsub" },
  };
  const templatedCtx = (renderMail?: ChannelContext["renderMail"]): ChannelContext => ({
    ...ctx,
    registry: createRegistry([templated]),
    ...(renderMail && { renderMail }),
  });

  test("a declared template renders through ctx.renderMail with locale, variables and unsubscribe url", async () => {
    const calls: unknown[] = [];
    const renderMail: NonNullable<ChannelContext["renderMail"]> = async (payload) => {
      calls.push(payload);
      return { subject: "Stored subject", html: "<p>stored</p>", text: "stored text" };
    };
    const transport = createInMemoryTransport();
    const channel = channelWith(transport);
    const renderedMessage = await channel.render?.(message, templatedCtx(renderMail));
    await channel.send("user@example.com", message, templatedCtx(renderMail), renderedMessage);

    expect(calls[0]).toEqual({
      slug: "tpl:notify:welcome",
      locale: "de",
      variables: message.data,
      unsubscribeUrl: "https://x.example/unsub",
    });
    expect(transport.sent[0]).toMatchObject({
      subject: "Stored subject",
      html: "<p>stored</p>",
      text: "stored text",
    });
  });

  test("a declared template without ctx.renderMail fails", async () => {
    await expect(
      channelWith(createInMemoryTransport()).render?.(message, templatedCtx()),
    ).rejects.toThrow(/renderMail/);
  });
});

describe("email channel attachments", () => {
  const FILE_REF_ID = "0190c000-0000-7000-8000-000000000001";
  const bytes = new Uint8Array([1, 2, 3]);
  const withReader = (
    readAttachment: NonNullable<ChannelContext["readAttachment"]>,
  ): ChannelContext => ({ ...ctx, readAttachment });
  const baseMessage: ChannelMessage = {
    notificationType: "n",
    title: "t",
    body: "b",
    data: { attachments: [{ kind: "file", fileRefId: FILE_REF_ID, fileName: "rechnung.pdf" }] },
  };

  test("a file ref from notify data is read and sent with the ref's file name", async () => {
    const transport = createInMemoryTransport();
    await channelWith(transport).send(
      "u@example.com",
      baseMessage,
      withReader(async () => ({ content: bytes, contentType: "application/pdf" })),
      rendered,
    );
    expect(transport.sent[0]?.attachments).toEqual([
      {
        kind: "file",
        fileRefId: FILE_REF_ID,
        fileName: "rechnung.pdf",
        content: bytes,
        contentType: "application/pdf",
      },
    ]);
  });

  test("an inline ref from the renderer is named after its cid and content type", async () => {
    const transport = createInMemoryTransport();
    await channelWith(transport).send(
      "u@example.com",
      { notificationType: "n", title: "t", body: "b", data: undefined },
      withReader(async () => ({ content: bytes, contentType: "image/png" })),
      { ...rendered, attachments: [{ kind: "inline", cid: "logo", fileRefId: FILE_REF_ID }] },
    );
    expect(transport.sent[0]?.attachments?.[0]).toMatchObject({
      kind: "inline",
      cid: "logo",
      fileName: "logo.png",
    });
  });

  test("a missing inline image is skipped, a missing file fails the send", async () => {
    const transport = createInMemoryTransport();
    const readNothing = withReader(async () => null);
    await channelWith(transport).send(
      "u@example.com",
      { notificationType: "n", title: "t", body: "b", data: undefined },
      readNothing,
      { ...rendered, attachments: [{ kind: "inline", cid: "logo", fileRefId: FILE_REF_ID }] },
    );
    expect(transport.sent[0]?.attachments).toBeUndefined();
    await expect(
      channelWith(transport).send("u@example.com", baseMessage, readNothing, rendered),
    ).rejects.toThrow(/not found/);
  });

  test("refs without a channel context that can read files fail loudly", async () => {
    await expect(
      channelWith(createInMemoryTransport()).send("u@example.com", baseMessage, ctx, rendered),
    ).rejects.toThrow(/cannot read files/);
  });

  test("notify data cannot create inline attachments or oversize lists", () => {
    expect(() =>
      fileAttachmentsFrom({
        attachments: [{ kind: "inline", cid: "logo", fileRefId: FILE_REF_ID }],
      }),
    ).toThrow();
    expect(() =>
      fileAttachmentsFrom({
        attachments: Array.from({ length: 21 }, () => ({
          kind: "file",
          fileRefId: FILE_REF_ID,
          fileName: "a.pdf",
        })),
      }),
    ).toThrow();
    expect(() =>
      fileAttachmentsFrom({
        attachments: [{ kind: "file", fileRefId: FILE_REF_ID, fileName: "../etc/passwd" }],
      }),
    ).toThrow();
    expect(fileAttachmentsFrom(undefined)).toEqual([]);
  });
});

describe("email channel notifications without a template", () => {
  test("fail with an error naming the notification type", async () => {
    const withoutTemplate = defineFeature("plain", (r) => {
      r.notification("hello", {});
    });
    const message: ChannelMessage = {
      notificationType: "plain:notify:hello",
      title: "t",
      body: "b",
      data: undefined,
    };
    await expect(
      channelWith(createInMemoryTransport()).render?.(message, {
        ...ctx,
        registry: createRegistry([withoutTemplate]),
      }),
    ).rejects.toThrow(
      /plain:notify:hello.*has no mail template, declare template \+ meta on r\.notification/,
    );
  });
});
