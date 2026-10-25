// feature.ts contract tests for inbound-mail-foundation.

import { describe, expect, test } from "bun:test";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { inboundMessageAggregateId, mailThreadAggregateId } from "../aggregate-id.ts";
import {
  INBOUND_MAIL_FOUNDATION_FEATURE,
  INBOUND_MAIL_PROVIDER_EXTENSION,
  inboundCredentialSecretKey,
} from "../constants.ts";
import { createInboundMailFoundationFeature } from "../feature.ts";
import { isVisibleToCaller } from "../handlers/scope-visibility.ts";
import { signOAuthState, verifyOAuthState } from "../oauth-state.ts";
import { isInboundMailProviderPlugin } from "../types.ts";

describe("inboundMailFoundationFeature — shape", () => {
  test("has the expected name", () => {
    expect(createInboundMailFoundationFeature().name).toBe(INBOUND_MAIL_FOUNDATION_FEATURE);
    expect(createInboundMailFoundationFeature().name).toBe("inbound-mail-foundation");
  });

  test("does NOT require config — Multi-Provider, provider config is in the plugins", () => {
    // Drift pin: there is no global provider-config key. A tenant can connect
    // IMAP, M365, and Gmail in parallel; the provider is stored per
    // MailAccount row.
    expect(createInboundMailFoundationFeature().requires).not.toContain("config");
  });

  test("declares the 'inboundMailProvider' extension-point", () => {
    expect(Object.keys(createInboundMailFoundationFeature().registrarExtensions)).toContain(
      INBOUND_MAIL_PROVIDER_EXTENSION,
    );
  });

  test("5 domain-events registriert", () => {
    const events = createInboundMailFoundationFeature().events;
    expect(Object.keys(events).sort()).toEqual([
      "inbound-message-received",
      "mail-account-connected",
      "mail-account-disconnected",
      "mail-account-updated",
      "mail-thread-updated",
    ]);
  });

  test("SyncCursor + SeenMessage are unmanaged (NOT event-sourced)", () => {
    // If modeled as r.entity, the tick-state tables would flood the event log
    // and be wiped during projection rebuilds.
    const unmanaged = Object.keys(createInboundMailFoundationFeature().storeTables);
    expect(unmanaged.length).toBe(2);
  });
});

describe("aggregate-ids — deterministic drift-pins", () => {
  // A namespace change would re-key every existing stream and break
  // idempotency, so these values are computed only once.
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

  test("shared row (ownerUserId=null) is visible to everyone", () => {
    expect(isVisibleToCaller({ ownerUserId: null }, owner)).toBe(true);
    expect(isVisibleToCaller({ ownerUserId: null }, other)).toBe(true);
  });

  test("personal row only for owner + TenantAdmin", () => {
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

  test("inboundCredentialSecretKey is keyed per account", () => {
    expect(inboundCredentialSecretKey("abc")).toBe(
      "inbound-mail-foundation:inbound.credential.abc",
    );
  });
});
