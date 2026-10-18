// Builds the real MIME message through nodemailer's stream transport, so the
// From header encoding (quoting, injection handling) and the MIME structure
// are proven, not assumed.
// The mock is restored in afterAll — see smtp-transport-pinning.test.ts.

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

// A snapshot, not the namespace: mock.module rewrites the namespace object in
// place, so both the lookup inside the mock and the afterAll restore would hit
// the mock itself.
const realNodemailer = { ...(await import("nodemailer")) };
const createRealTransport = realNodemailer.createTransport;
let rawMessage = "";
mock.module("nodemailer", () => ({
  createTransport: () => {
    const streaming = createRealTransport({ streamTransport: true, buffer: true });
    return {
      sendMail: async (mail: Parameters<typeof streaming.sendMail>[0]) => {
        const result = await streaming.sendMail(mail);
        rawMessage = result.message.toString();
        return result;
      },
    };
  },
}));

const { createSmtpTransport } = await import("../smtp-transport.ts");

afterAll(() => {
  mock.module("nodemailer", () => realNodemailer);
});

beforeEach(() => {
  rawMessage = "";
});

function headerBlock(): string {
  return rawMessage.split(/\r?\n\r?\n/)[0] ?? "";
}

function headerLines(name: string): string[] {
  return headerBlock()
    .split(/\r?\n(?![ \t])/)
    .filter((line) => line.toLowerCase().startsWith(`${name.toLowerCase()}:`));
}

const mail = { to: "user@example.com", subject: "Hi", html: "<p>x</p>" };

describe("createSmtpTransport — fromName", () => {
  test("without fromName the From header is exactly the configured default", async () => {
    const transport = createSmtpTransport({ host: "localhost", from: "App <noreply@x.test>" });
    await transport.send(mail);
    expect(headerLines("From")).toEqual(["From: App <noreply@x.test>"]);
  });

  test("fromName replaces the name of the default From and keeps its address", async () => {
    const transport = createSmtpTransport({ host: "localhost", from: "App <noreply@x.test>" });
    await transport.send({ ...mail, fromName: "Tenant via veridom" });
    expect(headerLines("From")).toEqual(["From: Tenant via veridom <noreply@x.test>"]);
  });

  test("fromName combines with a per-message from address", async () => {
    const transport = createSmtpTransport({ host: "localhost", from: "noreply@x.test" });
    await transport.send({ ...mail, from: "verwaltung@haus.test", fromName: "Verwaltung" });
    expect(headerLines("From")).toEqual(["From: Verwaltung <verwaltung@haus.test>"]);
  });

  test("an address embedded in the name is neutralised, the address stays the configured one", async () => {
    const transport = createSmtpTransport({ host: "localhost", from: "noreply@x.test" });
    await transport.send({ ...mail, fromName: 'Evil" <attacker@y.test>' });
    expect(headerLines("From")).toEqual(['From: "Evil\\"  attacker y.test" <noreply@x.test>']);
    expect(headerBlock()).not.toContain("attacker@y.test");
  });

  test("CR/LF in the name cannot add a Bcc or any other header", async () => {
    const transport = createSmtpTransport({ host: "localhost", from: "noreply@x.test" });
    await transport.send({ ...mail, fromName: "Tenant\r\nBcc: evil@x.test" });
    expect(headerLines("Bcc")).toEqual([]);
    expect(headerLines("From")).toHaveLength(1);
    expect(headerBlock()).not.toContain("evil@x.test\r\n");
    expect(headerLines("From")[0]).toContain("<noreply@x.test>");
  });

  test("a blank or control-only fromName behaves like no fromName", async () => {
    const transport = createSmtpTransport({ host: "localhost", from: "App <noreply@x.test>" });
    await transport.send({ ...mail, fromName: " \r\n\t " });
    expect(headerLines("From")).toEqual(["From: App <noreply@x.test>"]);
  });
});

describe("createSmtpTransport — text part", () => {
  test("text alongside html yields multipart/alternative with both parts", async () => {
    const transport = createSmtpTransport({ host: "localhost", from: "noreply@x.test" });
    await transport.send({ ...mail, text: "plain body" });
    expect(headerBlock()).toMatch(/Content-Type: multipart\/alternative;/);
    expect(rawMessage).toMatch(/Content-Type: text\/plain; charset=utf-8\r?\n[\s\S]*?plain body/);
    expect(rawMessage).toMatch(/Content-Type: text\/html; charset=utf-8/);
  });

  test("without text the mail stays a single html part", async () => {
    const transport = createSmtpTransport({ host: "localhost", from: "noreply@x.test" });
    await transport.send(mail);
    expect(headerBlock()).toMatch(/Content-Type: text\/html; charset=utf-8/);
    expect(rawMessage).not.toContain("multipart/alternative");
  });
});

const attachmentMail = { to: "user@example.com", subject: "Hi", html: '<img src="cid:logo">' };
const attachmentTransport = () =>
  createSmtpTransport({ host: "localhost", from: "App <noreply@x.test>" });

describe("createSmtpTransport attachments", () => {
  test("an inline image carries its Content-ID and inline disposition", async () => {
    await attachmentTransport().send({
      ...attachmentMail,
      attachments: [
        {
          kind: "inline",
          cid: "logo",
          fileRefId: "id",
          fileName: "logo.png",
          content: new Uint8Array([137, 80, 78, 71]),
          contentType: "image/png",
        },
      ],
    });
    expect(rawMessage).toContain("Content-ID: <logo>");
    expect(rawMessage).toContain("Content-Disposition: inline");
    expect(rawMessage).toContain("Content-Type: image/png");
    expect(rawMessage).toContain(Buffer.from([137, 80, 78, 71]).toString("base64"));
  });

  test("a file attachment is sent with its name and bytes and no Content-ID", async () => {
    await attachmentTransport().send({
      ...attachmentMail,
      attachments: [
        {
          kind: "file",
          fileRefId: "id",
          fileName: "rechnung.pdf",
          content: new TextEncoder().encode("%PDF-1.4"),
          contentType: "application/pdf",
        },
      ],
    });
    expect(rawMessage).toContain("filename=rechnung.pdf");
    expect(rawMessage).toContain(Buffer.from("%PDF-1.4").toString("base64"));
    expect(rawMessage).not.toContain("Content-ID:");
  });

  test("a message without attachments stays a plain mail", async () => {
    await attachmentTransport().send(attachmentMail);
    expect(rawMessage).not.toContain("Content-Disposition");
  });
});
