// feature.ts contract tests for inbound-mail-foundation.

import { describe, expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import { inboundMessageAggregateId, mailThreadAggregateId } from "../aggregate-id";
import {
  INBOUND_MAIL_FOUNDATION_FEATURE,
  INBOUND_MAIL_PROVIDER_EXTENSION,
  inboundCredentialSecretKey,
} from "../constants";
import { inboundMailFoundationFeature } from "../feature";
import { isVisibleToCaller } from "../handlers/scope-visibility";
import { signOAuthState, verifyOAuthState } from "../oauth-state";
import { isInboundMailProviderPlugin } from "../types";

describe("inboundMailFoundationFeature — shape", () => {
  test("has the expected name", () => {
    expect(inboundMailFoundationFeature.name).toBe(INBOUND_MAIL_FOUNDATION_FEATURE);
    expect(inboundMailFoundationFeature.name).toBe("inbound-mail-foundation");
  });

  test("does NOT require config — Multi-Provider, Provider-Config liegt in den Plugins", () => {
    // Drift-Pin (Plan §1.3): KEIN globaler provider-config-key. Ein
    // Tenant kann parallel IMAP + M365 + Gmail verbinden — der Provider
    // steht pro MailAccount-Row.
    expect(inboundMailFoundationFeature.requires).not.toContain("config");
  });

  test("declares the 'inboundMailProvider' extension-point", () => {
    expect(
      inboundMailFoundationFeature.registrarExtensions[INBOUND_MAIL_PROVIDER_EXTENSION],
    ).toBeDefined();
  });

  test("5 domain-events registriert", () => {
    const events = inboundMailFoundationFeature.events;
    expect(events["mail-account-connected"]).toBeDefined();
    expect(events["mail-account-updated"]).toBeDefined();
    expect(events["mail-account-disconnected"]).toBeDefined();
    expect(events["inbound-message-received"]).toBeDefined();
    expect(events["mail-thread-updated"]).toBeDefined();
  });

  test("SyncCursor + SeenMessage sind unmanaged (NICHT event-sourced, Plan §3.4)", () => {
    // Drift-Pin: als r.entity würden die Tick-State-Tabellen (a) das
    // Event-Log fluten und (b) beim Projection-Rebuild gewischt.
    const unmanaged = Object.keys(inboundMailFoundationFeature.rawTables);
    expect(unmanaged.length).toBe(2);
  });
});

describe("aggregate-ids — deterministic drift-pins", () => {
  // In Stein gemeißelt: ein Namespace-Wechsel würde jeden existing
  // Stream re-keyen → kaputte Idempotency. Werte einmalig berechnet.
  test("inboundMessageAggregateId is stable", () => {
    expect(inboundMessageAggregateId("11111111-1111-1111-1111-111111111111", "uid-42")).toBe(
      "c3a5c3fc-706e-5c66-8617-d6c08e0f4a6b",
    );
  });

  test("mailThreadAggregateId is stable", () => {
    expect(
      mailThreadAggregateId("22222222-2222-2222-2222-222222222222", "mid:root@example.com"),
    ).toBe("45c4d3a9-0a97-5a0b-a3c5-4ba9c8740dcd");
  });

  test("same account + same providerMessageId → same stream (dedup anchor)", () => {
    const a = inboundMessageAggregateId("acc", "m1");
    expect(inboundMessageAggregateId("acc", "m1")).toBe(a);
    expect(inboundMessageAggregateId("acc2", "m1")).not.toBe(a);
    expect(inboundMessageAggregateId("acc", "m2")).not.toBe(a);
  });
});

describe("oauth-state — sign/verify roundtrip", () => {
  const secret = "test-state-secret";
  const payload = {
    tenantId: "00000000-0000-0000-0000-00000000aaaa",
    ownerUserId: "00000000-0000-0000-0000-00000000bbbb",
    providerKey: "imap",
    mailbox: "user@example.com",
  };

  test("roundtrip carries tenantId + ownerUserId + providerKey + mailbox", () => {
    const state = signOAuthState(payload, 15, secret);
    const verified = verifyOAuthState(state, secret);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.payload.tenantId).toBe(payload.tenantId);
    expect(verified.payload.ownerUserId).toBe(payload.ownerUserId);
    expect(verified.payload.providerKey).toBe("imap");
    expect(verified.payload.mailbox).toBe("user@example.com");
    expect(verified.payload.nonce.length).toBeGreaterThan(0);
  });

  test("ownerUserId=null (shared mailbox) survives the roundtrip", () => {
    const state = signOAuthState({ ...payload, ownerUserId: null }, 15, secret);
    const verified = verifyOAuthState(state, secret);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.payload.ownerUserId).toBeNull();
  });

  test("tampered payload → bad_signature", () => {
    const state = signOAuthState(payload, 15, secret);
    const [b64, exp, sig] = state.split(".");
    const evil = {
      ...payload,
      tenantId: "00000000-0000-0000-0000-00000000cccc",
      nonce: "x",
    };
    const evilB64 = Buffer.from(JSON.stringify(evil), "utf8").toString("base64url");
    const forged = `${evilB64}.${exp}.${sig}`;
    expect(b64).not.toBe(evilB64);
    expect(verifyOAuthState(forged, secret)).toEqual({ ok: false, reason: "bad_signature" });
  });

  test("wrong secret → bad_signature", () => {
    const state = signOAuthState(payload, 15, secret);
    expect(verifyOAuthState(state, "other-secret")).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  test("expired state → expired", () => {
    const past = Temporal.Now.instant().subtract({ hours: 1 });
    const state = signOAuthState(payload, 15, secret, past);
    expect(verifyOAuthState(state, secret)).toEqual({ ok: false, reason: "expired" });
  });

  test("garbage → malformed", () => {
    expect(verifyOAuthState("not-a-state", secret)).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("scope-visibility (Plan Entscheidung 2)", () => {
  const owner = { id: "user-1", roles: ["User"] as const };
  const other = { id: "user-2", roles: ["User"] as const };
  const admin = { id: "user-3", roles: ["TenantAdmin"] as const };

  test("shared row (ownerUserId=null) ist für alle sichtbar", () => {
    expect(isVisibleToCaller({ ownerUserId: null }, owner)).toBe(true);
    expect(isVisibleToCaller({ ownerUserId: null }, other)).toBe(true);
  });

  test("persönliche Row nur für Owner + TenantAdmin", () => {
    const row = { ownerUserId: "user-1" };
    expect(isVisibleToCaller(row, owner)).toBe(true);
    expect(isVisibleToCaller(row, other)).toBe(false);
    expect(isVisibleToCaller(row, admin)).toBe(true);
  });
});

describe("plugin type-guard + secret-key helper", () => {
  test("isInboundMailProviderPlugin verlangt verify + fetch", () => {
    expect(isInboundMailProviderPlugin({ verify: async () => {}, fetch: async () => ({}) })).toBe(
      true,
    );
    expect(isInboundMailProviderPlugin({ verify: async () => {} })).toBe(false);
    expect(isInboundMailProviderPlugin(null)).toBe(false);
  });

  test("inboundCredentialSecretKey ist per-Account gekeyt", () => {
    expect(inboundCredentialSecretKey("abc")).toBe(
      "inbound-mail-foundation:inbound.credential.abc",
    );
  });
});
