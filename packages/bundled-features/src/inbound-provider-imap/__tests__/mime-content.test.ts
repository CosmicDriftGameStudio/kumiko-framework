// Real .eml fixtures through the same parser the provider uses: what becomes text, original,
// attachment, or a skipped attachment, and which mails the parser cannot read at all.

import { describe, expect, test } from "bun:test";
import { normalizeRawInboundMessage } from "../../inbound-mail-foundation/index.ts";
import { MIME_FORWARD_MAX_DEPTH } from "../mime-content.ts";
import { parseOrReject } from "../parse-message.ts";
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
    expect(message.text).toBe("HELLO\n\nOnly an HTML part, no text alternative.");
    expect(message.snippet).toBe("HELLO\n\nOnly an HTML part, no text alternative.");
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

  test("cid images stay links in the HTML and a related HTML part without a text part gives the text", async () => {
    const { message } = await parseFixture("inline-logo-and-apple-pdf.eml");

    expect(message.html).toContain('src="cid:logo@fixture.test"');
    expect(message.html).not.toContain("data:");
    expect(message.text).toBe("Contract below.");
  });

  test("HTML nested past the limit keeps the mail with empty text", async () => {
    const mail = [
      "From: Alice <alice@example.com>\r\n",
      "Subject: Deep\r\n",
      "Message-ID: <deep@fixture.test>\r\n",
      "MIME-Version: 1.0\r\n",
      "Content-Type: text/html; charset=utf-8\r\n",
      "\r\n",
      "<p><li>".repeat(1001) + "</x>".repeat(1000),
    ].join("");

    const result = await parseOrReject({
      source: new TextEncoder().encode(mail),
      uid: 3,
      uidValidity: "7",
      internalDate: undefined,
    });

    if (!("message" in result)) throw new Error("rejected");
    expect(result.message.html).toContain("<p><li>");
    expect(result.message.text).toBe("");
    expect(result.message.snippet).toBe("");
  });

  describe("text of mails with an HTML part", () => {
    const header = (contentType: string) =>
      `From: Alice <alice@example.com>\r\nSubject: S\r\nMessage-ID: <t@fixture.test>\r\nMIME-Version: 1.0\r\nContent-Type: ${contentType}\r\n\r\n`;
    const multipart = (kind: string, parts: ReadonlyArray<readonly [string, string]>) =>
      `${header(`multipart/${kind}; boundary="B"`)}${parts
        .map(([type, body]) => `--B\r\nContent-Type: ${type}; charset=utf-8\r\n\r\n${body}\r\n`)
        .join("")}--B--\r\n`;
    const textOf = async (mail: string) => {
      const result = await parseOrReject({
        source: new TextEncoder().encode(mail),
        uid: 4,
        uidValidity: "7",
        internalDate: undefined,
      });
      if (!("message" in result)) throw new Error("rejected");
      return result.message;
    };

    test("an HTML-only mail gets its text from the HTML", async () => {
      const message = await textOf(
        `${header("text/html; charset=utf-8")}<html><body><h1>Hello</h1><p>Only HTML.</p></body></html>`,
      );
      expect(message.text).toBe("HELLO\n\nOnly HTML.");
    });

    test("mixed with an HTML part and a text footer keeps the HTML content in the text", async () => {
      const message = await textOf(
        multipart("mixed", [
          ["text/html", "<p>The actual message of the list post.</p>"],
          ["text/plain", "____\r\nlist footer"],
        ]),
      );
      expect(message.text).toContain("The actual message of the list post.");
      expect(message.text).toContain("list footer");
      expect(message.snippet).toContain("The actual message of the list post.");
    });

    test("mixed with a text part and an HTML part contains both", async () => {
      const message = await textOf(
        multipart("mixed", [
          ["text/plain", "Intro text part."],
          ["text/html", "<p>HTML part with the details.</p>"],
        ]),
      );
      expect(message.text).toContain("Intro text part.");
      expect(message.text).toContain("HTML part with the details.");
    });

    test("alternative keeps only the text part as text", async () => {
      const message = await textOf(
        multipart("alternative", [
          ["text/plain", "plain"],
          ["text/html", "<p>html</p>"],
        ]),
      );
      expect(message.text).toBe("plain");
    });
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

    expect(result).toEqual({
      rejected: { providerMessageId: "7:9", reason: "unparseable", rawMime: source },
    });
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

describe("an unreadable forwarded mail", () => {
  test("stays an attachment and the outer mail is still read", async () => {
    const poison = Buffer.from(buildMailWithTooManyParts(MAILPARSER_MAX_MIME_NODES)).toString(
      "latin1",
    );
    const outer = [
      "From: a@example.com",
      "Message-ID: <outer@x>",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="O"',
      "",
      "--O",
      "Content-Type: text/plain",
      "",
      "outer text",
      "--O",
      "Content-Type: message/rfc822",
      "",
      poison,
      "--O--",
      "",
    ].join("\r\n");

    const result = await parseOrReject({
      source: new TextEncoder().encode(outer),
      uid: 2,
      uidValidity: "7",
      internalDate: undefined,
    });

    if (!("message" in result)) throw new Error("rejected");
    expect(result.message.text).toContain("outer text");
    expect(result.message.attachments?.map((a) => [a.fileName, a.mimeType])).toEqual([
      ["forwarded.eml", "message/rfc822"],
    ]);
  });
});
