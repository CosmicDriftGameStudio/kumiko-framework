// Real .eml fixtures through the same parser the provider uses: what becomes text, original,
// attachment, or a skipped attachment, and which mails the parser cannot read at all.

import { describe, expect, test } from "bun:test";
import { normalizeRawInboundMessage } from "../../inbound-mail-foundation/index.ts";
import { parseOrReject } from "../imap-client.ts";
import { MIME_FORWARD_MAX_DEPTH } from "../mime-content.ts";
import { buildMailWithTooManyParts, MAILPARSER_MAX_MIME_NODES } from "./too-many-parts-mail.ts";

async function parseFixture(name: string) {
  const source = new Uint8Array(
    await Bun.file(`${import.meta.dir}/fixtures/${name}`).arrayBuffer(),
  );
  const result = await parseOrReject({
    source,
    uid: 1,
    uidValidity: "7",
    internalDate: undefined,
  });
  if (!("message" in result)) throw new Error(`fixture ${name} was rejected`);
  return { message: result.message, source };
}

describe("parsed fixtures", () => {
  test("an HTML-only mail keeps its HTML and has no attachments", async () => {
    const { message } = await parseFixture("html-only.eml");

    expect(message.html).toContain("<h1>Hello</h1>");
    expect(message.attachments).toEqual([]);
  });

  test("text plus PDF: full text and the PDF as attachment, original bytes are the source", async () => {
    const { message, source } = await parseFixture("text-with-pdf.eml");

    expect(message.text).toBe("Please find the invoice attached.");
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments?.[0]).toMatchObject({
      fileName: "invoice.pdf",
      mimeType: "application/pdf",
    });
    expect(Buffer.from(message.attachments?.[0]?.data ?? []).toString("latin1")).toStartWith(
      "%PDF-1.4",
    );
    expect(message.rawMime).toEqual(source);
  });

  test("an inline logo is no attachment, an inline PDF with a Content-Id is", async () => {
    const { message } = await parseFixture("inline-logo-and-apple-pdf.eml");

    expect(message.attachments?.map((a) => a.fileName)).toEqual(["contract.pdf"]);
    expect(message.skippedAttachments ?? []).toEqual([]);
  });

  test("a forwarded .eml contributes its text and its PDF", async () => {
    const { message } = await parseFixture("forwarded-eml-with-pdf.eml");

    expect(message.text).toContain("Please take a look at this.");
    expect(message.text).toContain("Forwarded message");
    expect(message.text).toContain("The original text from Bob.");
    expect(message.attachments?.map((a) => a.fileName)).toEqual(["spec.pdf"]);
  });

  test("a mail without From normalizes to the placeholder sender", async () => {
    const { message } = await parseFixture("no-from.eml");

    expect(message.from).toBe("");
    expect(normalizeRawInboundMessage(message).from).toBe("(no sender)");
  });

  test("more than 200 References are cut to the root plus the newest ones", async () => {
    const { message } = await parseFixture("many-references.eml");

    expect(message.references).toHaveLength(250);
    const normalized = normalizeRawInboundMessage(message);
    expect(normalized.references).toHaveLength(200);
    expect(normalized.references[0]).toBe("ref-0@fixture.test");
    expect(normalized.references.at(-1)).toBe("ref-249@fixture.test");
  });

  test("a structure the parser cannot read is rejected, not thrown", async () => {
    const source = buildMailWithTooManyParts(MAILPARSER_MAX_MIME_NODES);

    const result = await parseOrReject({
      source,
      uid: 9,
      uidValidity: "7",
      internalDate: undefined,
    });

    expect(result).toEqual({ rejected: { providerMessageId: "7:9", reason: "unparseable" } });
  });
});

// Each level forwards the previous mail as message/rfc822; the innermost carries a PDF.
function nestedForward(levels: number): Uint8Array {
  let inner = [
    "Subject: innermost",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="B0"',
    "",
    "--B0",
    "Content-Type: text/plain",
    "",
    "innermost text",
    "--B0",
    'Content-Type: application/pdf; name="deep.pdf"',
    'Content-Disposition: attachment; filename="deep.pdf"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from("%PDF-1.4 deep").toString("base64"),
    "--B0--",
    "",
  ].join("\r\n");
  for (let level = 1; level <= levels; level++) {
    inner = [
      `Subject: level ${level}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="B${level}"`,
      "",
      `--B${level}`,
      "Content-Type: text/plain",
      "",
      `text of level ${level}`,
      `--B${level}`,
      "Content-Type: message/rfc822",
      "",
      inner,
      `--B${level}--`,
      "",
    ].join("\r\n");
  }
  return new TextEncoder().encode(`From: a@example.com\r\nMessage-ID: <n@x>\r\n${inner}`);
}

describe("forward depth", () => {
  test("a mail forwarded up to the limit is read through", async () => {
    const result = await parseOrReject({
      source: nestedForward(MIME_FORWARD_MAX_DEPTH),
      uid: 1,
      uidValidity: "7",
      internalDate: undefined,
    });

    if (!("message" in result)) throw new Error("rejected");
    expect(result.message.attachments?.map((a) => a.fileName)).toEqual(["deep.pdf"]);
    expect(result.message.text).toContain("innermost text");
  });

  test("one level deeper is skipped with its reason instead of read", async () => {
    const result = await parseOrReject({
      source: nestedForward(MIME_FORWARD_MAX_DEPTH + 1),
      uid: 1,
      uidValidity: "7",
      internalDate: undefined,
    });

    if (!("message" in result)) throw new Error("rejected");
    expect(result.message.attachments).toEqual([]);
    expect(result.message.skippedAttachments?.map((s) => s.reason)).toEqual(["nesting_too_deep"]);
  });
});
