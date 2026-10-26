// IP-literal hosts: imapflow sets `servername: false` itself, which Bun's tls.connect rejects.
// The options must override it for IMAP; nodemailer omits a falsy servername, so SMTP must not
// carry the key at all. Host names keep their pinned-address SNI.

import { describe, expect, test } from "bun:test";
import { imapClientOptions } from "../imap-client.ts";
import { smtpTransportOptions } from "../smtp-client.ts";

const imapDoc = {
  host: "mail.example.com",
  port: 993,
  secure: true,
  user: "u",
  password: "p",
  smtpPort: 587,
} as const;
const smtpLogin = { host: "mail.example.com", port: 587, user: "u", password: "p" } as const;

describe("imapClientOptions", () => {
  test("an IP-literal host connects without SNI", () => {
    const options = imapClientOptions(imapDoc, { host: "127.0.0.1" });

    expect(options.host).toBe("127.0.0.1");
    expect(options).not.toHaveProperty("servername");
    expect(options).toHaveProperty("tls", { servername: undefined });
  });

  test("an IPv6 literal is treated like an IPv4 one", () => {
    const options = imapClientOptions(imapDoc, { host: "::1" });

    expect(options).toHaveProperty("tls", { servername: undefined });
  });

  test("a host name keeps the servername of the pinned address", () => {
    const options = imapClientOptions(imapDoc, {
      host: "93.184.216.34",
      servername: "mail.example.com",
    });

    expect(options.servername).toBe("mail.example.com");
  });

  test("connection, greeting and socket timeouts are explicit, the socket one outlasts IDLE", () => {
    const options = imapClientOptions(imapDoc, { host: "mail.example.com" });

    expect(options.connectionTimeout).toBe(20_000);
    expect(options.greetingTimeout).toBe(16_000);
    expect(options.socketTimeout).toBe(5 * 60_000);
  });

  test("a host name resolved to a public address sets no tls override", () => {
    const options = imapClientOptions(imapDoc, { host: "mail.example.com" });

    expect(options).not.toHaveProperty("tls");
  });
});

describe("smtpTransportOptions", () => {
  test("an IP-literal host carries no servername key", () => {
    const options = smtpTransportOptions(smtpLogin, { host: "127.0.0.1" });

    expect(options.host).toBe("127.0.0.1");
    expect(options).not.toHaveProperty("servername");
  });

  test("a pinned host name keeps its servername", () => {
    const options = smtpTransportOptions(smtpLogin, {
      host: "93.184.216.34",
      servername: "mail.example.com",
    });

    expect(options.servername).toBe("mail.example.com");
  });
});
