import { describe, expect, test } from "bun:test";
import { deriveSmtpHost } from "../connect-mailbox.ts";
import { pickSentMailboxPath } from "../sent-folder.ts";
import { classifySmtpError, smtpTransportOptions } from "../smtp-client.ts";

function smtpError(fields: Record<string, unknown>): Error {
  return Object.assign(new Error("smtp"), fields);
}

describe("deriveSmtpHost", () => {
  test("swaps a leading imap. for smtp., otherwise keeps the host", () => {
    expect(deriveSmtpHost("imap.all-inkl.com")).toBe("smtp.all-inkl.com");
    expect(deriveSmtpHost("IMAP.example.de")).toBe("smtp.example.de");
    expect(deriveSmtpHost("w0123.kasserver.com")).toBe("w0123.kasserver.com");
    expect(deriveSmtpHost("mail.imap.example")).toBe("mail.imap.example");
  });
});

describe("classifySmtpError", () => {
  test("maps nodemailer codes to the failure the tenant sees", () => {
    expect(classifySmtpError(smtpError({ code: "EAUTH", responseCode: 535 }))).toBe(
      "loginRejected",
    );
    expect(
      classifySmtpError(
        smtpError({ code: "ESOCKET", originalCode: "ERR_SSL_WRONG_VERSION_NUMBER" }),
      ),
    ).toBe("tlsFailed");
    expect(classifySmtpError(smtpError({ code: "ESOCKET", originalCode: "ECONNREFUSED" }))).toBe(
      "connectFailed",
    );
    expect(classifySmtpError(smtpError({ code: "EENVELOPE", responseCode: 550 }))).toBe("rejected");
    expect(classifySmtpError(new Error("anything else"))).toBe("connectFailed");
  });
});

describe("smtpTransportOptions", () => {
  const login = { host: "smtp.example.de", port: 465, user: "info", password: "pw" };

  test("connects to the pinned address and checks the certificate against the host name", () => {
    const options = smtpTransportOptions(login, {
      host: "203.0.113.9",
      servername: "smtp.example.de",
    });
    expect(options).toMatchObject({
      host: "203.0.113.9",
      servername: "smtp.example.de",
      port: 465,
      secure: true,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  });

  test("an allowlisted host connects by name without a separate servername", () => {
    expect(smtpTransportOptions(login, { host: "localhost" })).not.toHaveProperty("servername");
  });
});

describe("pickSentMailboxPath", () => {
  test("prefers the special-use flag over a folder name", () => {
    expect(
      pickSentMailboxPath([{ path: "Sent" }, { path: "Gesendete Elemente", specialUse: "\\Sent" }]),
    ).toBe("Gesendete Elemente");
  });

  test("falls back to the usual names, ignoring case", () => {
    expect(pickSentMailboxPath([{ path: "INBOX" }, { path: "gesendet" }])).toBe("gesendet");
    expect(pickSentMailboxPath([{ path: "INBOX" }, { path: "INBOX.Sent" }])).toBe("INBOX.Sent");
    expect(pickSentMailboxPath([{ path: "INBOX" }])).toBeUndefined();
  });
});
