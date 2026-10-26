import { describe, expect, test } from "bun:test";
import {
  INBOUND_ATTACHMENT_MAX_BYTES,
  INBOUND_ATTACHMENTS_MAX_COUNT,
  INBOUND_BODY_HTML_MAX_CHARS,
  INBOUND_BODY_TEXT_MAX_CHARS,
  INBOUND_MAIL_ATTACHMENTS_MAX_BYTES,
  INBOUND_MISSING_SENDER,
  INBOUND_RAW_MIME_MAX_BYTES,
  INBOUND_SKIPPED_ATTACHMENTS_MAX_COUNT,
  normalizeRawInboundMessage,
} from "../normalize-inbound-message.ts";
import type { RawInboundAttachment, RawInboundMessage } from "../types.ts";

function raw(overrides: Partial<RawInboundMessage> = {}): RawInboundMessage {
  return {
    providerMessageId: "1:1",
    messageIdHeader: "m@example.com",
    providerThreadId: null,
    references: [],
    from: "a@example.com",
    to: ["b@example.com"],
    cc: [],
    subject: "s",
    snippet: "n",
    receivedAtIso: "2026-07-15T10:00:00Z",
    rawMime: null,
    scope: "inbox",
    ...overrides,
  };
}

function attachment(size: number, name = "a.bin"): RawInboundAttachment {
  return { fileName: name, mimeType: "application/octet-stream", data: new Uint8Array(size) };
}

describe("body", () => {
  test("text up to the limit passes untouched", () => {
    const text = "x".repeat(INBOUND_BODY_TEXT_MAX_CHARS);

    const normalized = normalizeRawInboundMessage(raw({ text }));

    expect(normalized.bodyText).toBe(text);
    expect(normalized.bodyTextTruncated).toBe(false);
  });

  test("longer text is cut at the limit and flagged", () => {
    const normalized = normalizeRawInboundMessage(
      raw({ text: "x".repeat(INBOUND_BODY_TEXT_MAX_CHARS + 1) }),
    );

    expect(normalized.bodyText).toHaveLength(INBOUND_BODY_TEXT_MAX_CHARS);
    expect(normalized.bodyTextTruncated).toBe(true);
  });

  test("a cut never leaves half a surrogate pair", () => {
    const text = `${"x".repeat(INBOUND_BODY_TEXT_MAX_CHARS - 1)}😀`;

    const normalized = normalizeRawInboundMessage(raw({ text }));

    expect(normalized.bodyText).toHaveLength(INBOUND_BODY_TEXT_MAX_CHARS - 1);
    expect(normalized.bodyTextTruncated).toBe(true);
  });

  test("missing text becomes empty, oversized HTML is dropped", () => {
    const normalized = normalizeRawInboundMessage(
      raw({ html: "h".repeat(INBOUND_BODY_HTML_MAX_CHARS + 1) }),
    );

    expect(normalized.bodyText).toBe("");
    expect(normalized.bodyHtml).toBeNull();
  });
});

describe("envelope", () => {
  test("an empty sender becomes the placeholder", () => {
    expect(normalizeRawInboundMessage(raw({ from: "  " })).from).toBe(INBOUND_MISSING_SENDER);
  });

  test("more than 200 References keep the root and the newest 199", () => {
    const references = Array.from({ length: 250 }, (_, i) => `r${i}`);

    const normalized = normalizeRawInboundMessage(raw({ references }));

    expect(normalized.references).toHaveLength(200);
    expect(normalized.references[0]).toBe("r0");
    expect(normalized.references.at(-1)).toBe("r249");
  });

  test("an oversized Message-ID header is dropped", () => {
    expect(
      normalizeRawInboundMessage(raw({ messageIdHeader: "m".repeat(501) })).messageIdHeader,
    ).toBeNull();
  });
});

describe("attachment limits", () => {
  test("a single attachment above 25 MB is skipped as too_large", () => {
    const normalized = normalizeRawInboundMessage(
      raw({ attachments: [attachment(INBOUND_ATTACHMENT_MAX_BYTES + 1), attachment(10)] }),
    );

    expect(normalized.attachments).toHaveLength(1);
    expect(normalized.skippedAttachments).toEqual([
      {
        mimeType: "application/octet-stream",
        size: INBOUND_ATTACHMENT_MAX_BYTES + 1,
        reason: "too_large",
      },
    ]);
  });

  test("attachments beyond 50 MB in total are skipped as mail_too_large", () => {
    const sizes = [INBOUND_ATTACHMENT_MAX_BYTES, INBOUND_ATTACHMENT_MAX_BYTES, 1024];
    expect(sizes[0]! + sizes[1]!).toBeLessThanOrEqual(INBOUND_MAIL_ATTACHMENTS_MAX_BYTES);

    const normalized = normalizeRawInboundMessage(
      raw({ attachments: sizes.map((s) => attachment(s)) }),
    );

    expect(normalized.attachments).toHaveLength(2);
    expect(normalized.skippedAttachments.map((s) => s.reason)).toEqual(["mail_too_large"]);
  });

  test("more than 50 attachments keep the first 50", () => {
    const many = Array.from({ length: INBOUND_ATTACHMENTS_MAX_COUNT + 3 }, (_, i) =>
      attachment(1, `f${i}`),
    );

    const normalized = normalizeRawInboundMessage(raw({ attachments: many }));

    expect(normalized.attachments).toHaveLength(INBOUND_ATTACHMENTS_MAX_COUNT);
    expect(normalized.skippedAttachments).toHaveLength(3);
  });

  test("the skipped list is capped", () => {
    const skippedAttachments = Array.from({ length: 250 }, () => ({
      mimeType: "image/png",
      size: 1,
      reason: "rejected" as const,
    }));

    const normalized = normalizeRawInboundMessage(raw({ skippedAttachments }));

    expect(normalized.skippedAttachments).toHaveLength(INBOUND_SKIPPED_ATTACHMENTS_MAX_COUNT);
  });
});

describe("original message limit", () => {
  test("an original over the limit is dropped and reported, text and attachments stay", () => {
    const normalized = normalizeRawInboundMessage(
      raw({
        rawMime: new Uint8Array(INBOUND_RAW_MIME_MAX_BYTES + 1),
        text: "body",
        attachments: [attachment(10)],
      }),
    );

    expect(normalized.rawMime).toBeNull();
    expect(normalized.skippedAttachments).toEqual([
      { mimeType: "message/rfc822", size: INBOUND_RAW_MIME_MAX_BYTES + 1, reason: "too_large" },
    ]);
    expect(normalized.bodyText).toBe("body");
    expect(normalized.attachments).toHaveLength(1);
  });

  test("an original exactly at the limit is kept", () => {
    const rawMime = new Uint8Array(INBOUND_RAW_MIME_MAX_BYTES);

    const normalized = normalizeRawInboundMessage(raw({ rawMime }));

    expect(normalized.rawMime).toBe(rawMime);
    expect(normalized.skippedAttachments).toEqual([]);
  });
});
