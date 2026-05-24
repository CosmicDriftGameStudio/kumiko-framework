// Unit-Tests für composeFeatures.authOptions — pinst dass die
// passwordReset / emailVerification options an
// createAuthEmailPasswordFeature durchgereicht werden, sodass die
// request- und confirm-Handler im resultierenden Feature registriert
// sind. Bug-Pattern: ohne diesen Wiring würde runProdApp.options.auth.
// passwordReset = {sendResetEmail, appResetUrl} die routes mounten,
// aber die Handler fehlen → POST /api/auth/request-password-reset
// dispatched ins Leere → 500.

import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { describe, expect, test } from "bun:test";
import { composeFeatures } from "../compose-features";

const noopFeature = defineFeature("noop-app", () => {});

const HMAC_SECRET = "test-secret-with-at-least-32-bytes-aaa";

describe("composeFeatures", () => {
  test("includeBundled=false → nur App-Features", () => {
    const features = composeFeatures([noopFeature], { includeBundled: false });
    expect(features.map((f) => f.name)).toEqual(["noop-app"]);
  });

  test("includeBundled=true → 4 bundled Features davor", () => {
    const features = composeFeatures([noopFeature], { includeBundled: true });
    expect(features.map((f) => f.name)).toEqual([
      "config",
      "user",
      "tenant",
      "auth-email-password",
      "noop-app",
    ]);
  });

  test("authOptions.passwordReset → request-password-reset + reset-password handlers registriert", () => {
    const features = composeFeatures([noopFeature], {
      includeBundled: true,
      authOptions: { passwordReset: { hmacSecret: HMAC_SECRET } },
    });
    const auth = features.find((f) => f.name === "auth-email-password");
    expect(auth).toBeDefined();
    if (!auth) return;
    const handlerNames = Array.from(Object.keys(auth.writeHandlers));
    expect(handlerNames).toContain("request-password-reset");
    expect(handlerNames).toContain("reset-password");
  });

  test("authOptions.emailVerification → request-email-verification + verify-email handlers registriert", () => {
    const features = composeFeatures([noopFeature], {
      includeBundled: true,
      authOptions: { emailVerification: { hmacSecret: HMAC_SECRET } },
    });
    const auth = features.find((f) => f.name === "auth-email-password");
    expect(auth).toBeDefined();
    if (!auth) return;
    const handlerNames = Array.from(Object.keys(auth.writeHandlers));
    expect(handlerNames).toContain("request-email-verification");
    expect(handlerNames).toContain("verify-email");
  });

  test("OHNE authOptions → KEINE reset/verify-handlers (anti-default-deploy-bug)", () => {
    // Genau der Bug der vom Review-Agent gefangen wurde: composeFeatures
    // ohne authOptions registriert die handler nicht. Wenn jemand das
    // versehentlich vergisst und nur die routes (auth-routes-config)
    // wired, schlagen die requests auf prod fehl. Der Test pinst dass
    // dieser default-deny-Pfad bewusst leer ist.
    const features = composeFeatures([noopFeature], { includeBundled: true });
    const auth = features.find((f) => f.name === "auth-email-password");
    expect(auth).toBeDefined();
    if (!auth) return;
    const handlerNames = Array.from(Object.keys(auth.writeHandlers));
    expect(handlerNames).not.toContain("request-password-reset");
    expect(handlerNames).not.toContain("reset-password");
    expect(handlerNames).not.toContain("request-email-verification");
    expect(handlerNames).not.toContain("verify-email");
    // Die regulären auth-handlers (login/logout/change-password) MÜSSEN
    // aber immer da sein — das ist der core-flow.
    expect(handlerNames).toContain("login");
    expect(handlerNames).toContain("logout");
  });
});
