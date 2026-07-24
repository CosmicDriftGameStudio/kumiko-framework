// Unit-Tests für composeFeatures.authOptions — pinst dass die
// passwordReset / emailVerification options an
// createAuthEmailPasswordFeature durchgereicht werden, sodass die
// request- und confirm-Handler im resultierenden Feature registriert
// sind. Bug-Pattern: ohne diesen Wiring würde runProdApp.options.auth.
// passwordReset = {sendResetEmail, appResetUrl} die routes mounten,
// aber die Handler fehlen → POST /api/auth/request-password-reset
// dispatched ins Leere → 500.

import { describe, expect, spyOn, test } from "bun:test";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { composeFeatures } from "../compose-features";

const noopFeature = defineFeature("noop-app", () => {});

// Mirrors what the create-kumiko-app picker hands back when the user
// ticks an auto-mounted feature: a stub with the same name as a bundled
// one. The dedupe path drops it and warns.
const pickerAuthDupe = defineFeature("auth-email-password", () => {});

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
      authOptions: { passwordReset: { hmacSecret: HMAC_SECRET, appUrl: "https://app/reset" } },
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
      authOptions: { emailVerification: { hmacSecret: HMAC_SECRET, appUrl: "https://app/verify" } },
    });
    const auth = features.find((f) => f.name === "auth-email-password");
    expect(auth).toBeDefined();
    if (!auth) return;
    const handlerNames = Array.from(Object.keys(auth.writeHandlers));
    expect(handlerNames).toContain("request-email-verification");
    expect(handlerNames).toContain("verify-email");
  });

  test("authOptions.signup → signup-request + signup-confirm handlers registriert", () => {
    const features = composeFeatures([noopFeature], {
      includeBundled: true,
      authOptions: { signup: { appUrl: "https://app/signup/complete" } },
    });
    const auth = features.find((f) => f.name === "auth-email-password");
    expect(auth).toBeDefined();
    if (!auth) return;
    const handlerNames = Array.from(Object.keys(auth.writeHandlers));
    expect(handlerNames).toContain("signup-request");
    expect(handlerNames).toContain("signup-confirm");
  });

  // Regression: signup-request no-ops silently (always-200 anti-enumeration
  // contract) unless "auth-self-registration" is mounted. composeFeatures
  // must bundle it alongside authOptions.signup, not leave apps using the
  // includeBundled convenience path to mount it by hand.
  test("authOptions.signup → auth-self-registration mounted, default ON", () => {
    const features = composeFeatures([noopFeature], {
      includeBundled: true,
      authOptions: { signup: { appUrl: "https://app/signup/complete" } },
    });
    const toggle = features.find((f) => f.name === "auth-self-registration");
    expect(toggle).toBeDefined();
    // The security-relevant part isn't that the feature is mounted, it's
    // that self-signup defaults ON — a flip to `default: false` upstream
    // would silently no-op signup (always-200 anti-enumeration masks it)
    // while this assertion alone (toBeDefined) stayed green.
    expect(toggle?.toggleableDefault).toBe(true);
  });

  test("no authOptions.signup → auth-self-registration NOT mounted", () => {
    const features = composeFeatures([noopFeature], { includeBundled: true });
    expect(features.map((f) => f.name)).not.toContain("auth-self-registration");
  });

  test("authOptions.signup + app also mounts its own auth-self-registration stub → deduped to exactly one", () => {
    const pickerSelfRegDupe = defineFeature("auth-self-registration", () => {});
    const features = composeFeatures([noopFeature, pickerSelfRegDupe], {
      includeBundled: true,
      authOptions: { signup: { appUrl: "https://app/signup/complete" } },
    });
    const names = features.map((f) => f.name).filter((n) => n === "auth-self-registration");
    expect(names).toEqual(["auth-self-registration"]);
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

  test("app feature duplicating a bundled name is dropped (no createRegistry crash)", () => {
    // create-kumiko-app's picker hands back createAuthEmailPasswordFeature()
    // because the user ticked it in the recommended set; runDevApp then adds
    // its OWN bundled copy via includeBundled:true, and createRegistry throws
    // "Duplicate feature: auth-email-password". The dedupe path keeps the
    // bundled instance (it carries authOptions wiring) and drops the app stub.
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    const features = composeFeatures([pickerAuthDupe, noopFeature], {
      includeBundled: true,
    });
    // The warn is part of the fix contract (changeset: "warn so the user can
    // remove the line") — without this assertion the warn is removable with no RED.
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("auth-email-password"));
    warnSpy.mockRestore();
    expect(features.map((f) => f.name)).toEqual([
      "config",
      "user",
      "tenant",
      "auth-email-password",
      "noop-app",
    ]);
    // The kept instance is the bundled one — confirmed by the presence of
    // login/logout handlers (the picker stub has none).
    const auth = features.find((f) => f.name === "auth-email-password");
    expect(auth).toBeDefined();
    if (!auth) return;
    expect(Object.keys(auth.writeHandlers)).toContain("login");
  });
});
