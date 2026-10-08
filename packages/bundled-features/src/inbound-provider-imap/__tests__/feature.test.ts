// Contract- und Pure-Logic-Tests für inbound-provider-imap.
// Netz-lose Tests: Cursor-Semantik, References-Normalisierung,
// Credential-Dokument, Fehler-Mapping. Der echte IMAP-Roundtrip
// (greenmail/dovecot) ist opt-in, siehe imap-live.integration.test.ts.

import { describe, expect, test } from "bun:test";
import { composeEnvSchema } from "@cosmicdrift/kumiko-framework/env";
import { MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR } from "../../foundation-shared/index.js";
import {
  isInboundAuthError,
  isInboundCursorInvalidError,
  isInboundTransientError,
} from "../../inbound-mail-foundation/index.js";
import { mailTransportSmtpFeature } from "../../mail-transport-smtp/index.js";
import { parseImapCredentialDocument } from "../credential-document.js";
import { inboundProviderImapFeature } from "../feature.js";
import {
  assertUidValidity,
  buildProviderMessageId,
  mapImapError,
  normalizeReferences,
  parseImapCursor,
} from "../imap-client.js";

describe("inboundProviderImapFeature — shape", () => {
  test("has the expected name + requirements", () => {
    expect(inboundProviderImapFeature.name).toBe("inbound-provider-imap");
    expect(inboundProviderImapFeature.requires).toContain("inbound-mail-foundation");
    expect(inboundProviderImapFeature.requires).toContain("secrets");
  });

  test("declares the private-host allowlist env var, also next to mail-transport-smtp", () => {
    const alone = composeEnvSchema({ features: [inboundProviderImapFeature] });
    expect(alone.sources[MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR]).toBe("inbound-provider-imap");

    const withSmtp = composeEnvSchema({
      features: [mailTransportSmtpFeature, inboundProviderImapFeature],
    });
    expect(withSmtp.sources[MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR]).toBe("mail-transport-smtp");
  });
});

describe("cursor — UIDVALIDITY:lastUid", () => {
  test("parse roundtrip + malformed → null", () => {
    expect(parseImapCursor({ uidValidity: "17", lastUid: 42 })).toEqual({
      uidValidity: "17",
      lastUid: 42,
    });
    expect(parseImapCursor(null)).toBeNull();
    expect(parseImapCursor({ deltaLink: "graph" })).toBeNull();
    expect(parseImapCursor({ uidValidity: 17, lastUid: "42" })).toBeNull();
  });

  test("UIDVALIDITY-Wechsel → InboundCursorInvalidError (Voll-Resync)", () => {
    expect(() => assertUidValidity({ uidValidity: "17", lastUid: 42 }, "18")).toThrow();
    try {
      assertUidValidity({ uidValidity: "17", lastUid: 42 }, "18");
    } catch (e) {
      expect(isInboundCursorInvalidError(e)).toBe(true);
    }
    // Unverändert bzw. kein Cursor: kein Throw.
    assertUidValidity({ uidValidity: "17", lastUid: 42 }, "17");
    assertUidValidity(null, "18");
  });

  test("providerMessageId bindet UIDVALIDITY (UID allein ist nicht stabil)", () => {
    expect(buildProviderMessageId("17", 42)).toBe("17:42");
    expect(buildProviderMessageId("18", 42)).not.toBe(buildProviderMessageId("17", 42));
  });
});

describe("normalizeReferences", () => {
  test("string[]-Form, <>-stripping", () => {
    expect(normalizeReferences({ references: ["<a@x>", "<b@x>"] })).toEqual(["a@x", "b@x"]);
  });

  test("whitespace-getrennter string wird gesplittet", () => {
    expect(normalizeReferences({ references: "<a@x> <b@x>" })).toEqual(["a@x", "b@x"]);
  });

  test("ohne References fällt In-Reply-To als Thread-Anker ein", () => {
    expect(normalizeReferences({ inReplyTo: "<parent@x>" })).toEqual(["parent@x"]);
    expect(normalizeReferences({})).toEqual([]);
  });
});

describe("credential document", () => {
  test("password-Dokument parsed mit Defaults (port 993, secure)", () => {
    const r = parseImapCredentialDocument(
      JSON.stringify({ host: "imap.example.com", user: "u@example.com", password: "pw" }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.port).toBe(993);
    expect(r.doc.secure).toBe(true);
  });

  test("weder password noch accessToken → abgelehnt", () => {
    const r = parseImapCredentialDocument(
      JSON.stringify({ host: "imap.example.com", user: "u@example.com" }),
    );
    expect(r.ok).toBe(false);
  });

  test("kein JSON → abgelehnt", () => {
    expect(parseImapCredentialDocument("not-json").ok).toBe(false);
  });
});

describe("mapImapError — typisierte Fehlerklassen (Plan §2)", () => {
  test("Auth-Fehler → InboundAuthError (kein Retry, needs re-connect)", () => {
    expect(isInboundAuthError(mapImapError(new Error("Authentication failed"), "h"))).toBe(true);
    expect(isInboundAuthError(mapImapError(new Error("Invalid credentials (Failure)"), "h"))).toBe(
      true,
    );
  });

  test("Netz-Fehler → InboundTransientError (Job-Retry)", () => {
    expect(isInboundTransientError(mapImapError(new Error("ECONNREFUSED"), "h"))).toBe(true);
    expect(isInboundTransientError(mapImapError(new Error("getaddrinfo ENOTFOUND x"), "h"))).toBe(
      true,
    );
  });

  test("Unbekanntes → transient (retry schadet nicht)", () => {
    expect(isInboundTransientError(mapImapError(new Error("weird server burp"), "h"))).toBe(true);
  });
});
