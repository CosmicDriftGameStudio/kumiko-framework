// Builds the real MIME message through nodemailer's stream transport, so the
// From header encoding (quoting, injection handling) is proven, not assumed.
// The mock is restored in afterAll — see smtp-transport-pinning.test.ts.

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

const realNodemailer = await import("nodemailer");
// Captured before mocking: mock.module rewrites the namespace object in place, so a
// lookup through it from inside the mock would call the mock itself.
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

const { createSmtpTransport } = await import("../smtp-transport.js");

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

  test("a double quote in the name is escaped inside a quoted display name, the address stays the configured one", async () => {
    const transport = createSmtpTransport({ host: "localhost", from: "noreply@x.test" });
    await transport.send({ ...mail, fromName: 'Evil" <attacker@y.test>' });
    expect(headerLines("From")).toEqual(['From: "Evil\\" <attacker@y.test>" <noreply@x.test>']);
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
