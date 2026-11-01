import { afterEach, describe, expect, test } from "bun:test";
import {
  jsonResponse,
  restoreFetch,
  sentBody,
  stubFetch,
} from "../../../shared/__tests__/fetch-test-utils.ts";
import {
  acceptInviteSignedIn,
  acceptInviteWithLogin,
  acceptInviteWithNewAccount,
  confirmAccountUnlock,
  fetchInviteInfo,
  fetchSignupRegistrationStatus,
  logout,
  requestAccountUnlock,
  requestPasswordReset,
  resetPassword,
  verifyEmail,
} from "../static-account.ts";

afterEach(restoreFetch);

describe("fetchSignupRegistrationStatus", () => {
  test("reads enabled from the anonymous status query", async () => {
    const seen = stubFetch(() => jsonResponse({ data: { enabled: false } }));
    expect(await fetchSignupRegistrationStatus()).toEqual({
      kind: "success",
      data: { enabled: false },
    });
    expect(sentBody(seen[0])).toEqual({
      type: "auth-email-password:query:signup-registration-status",
      payload: {},
    });
  });

  test("an unexpected body is a failure", async () => {
    stubFetch(() => jsonResponse({ data: { enabled: "yes" } }));
    expect(await fetchSignupRegistrationStatus()).toEqual({
      kind: "failure",
      reason: "unexpected_response",
    });
  });
});

describe("password reset and e-mail verification", () => {
  test("requestPasswordReset sends the locale and only a safe returnTo", async () => {
    const seen = stubFetch(() => jsonResponse({ isSuccess: true }));
    await requestPasswordReset("a@b.de", { locale: "de", returnTo: "/app/home" });
    await requestPasswordReset("a@b.de", { returnTo: "//evil.example" });
    expect(seen[0]?.url).toBe("/api/auth/request-password-reset");
    expect(sentBody(seen[0])).toEqual({ email: "a@b.de", returnTo: "/app/home" });
    expect(seen[0]?.init?.headers).toMatchObject({ "X-Locale": "de" });
    expect(sentBody(seen[1])).toEqual({ email: "a@b.de" });
  });

  test("resetPassword and verifyEmail post the token", async () => {
    const seen = stubFetch(() => jsonResponse({ isSuccess: true }));
    expect(await resetPassword("t1", "new-pass-123")).toEqual({ kind: "success", data: undefined });
    expect(await verifyEmail("t2")).toEqual({ kind: "success", data: undefined });
    expect(seen[0]?.url).toBe("/api/auth/reset-password");
    expect(sentBody(seen[0])).toEqual({ token: "t1", newPassword: "new-pass-123" });
    expect(seen[1]?.url).toBe("/api/auth/verify-email");
    expect(sentBody(seen[1])).toEqual({ token: "t2" });
  });

  test("a rejected token is a failure with the server's reason", async () => {
    stubFetch(() =>
      jsonResponse(
        { error: { code: "unprocessable", details: { reason: "invalid_reset_token" } } },
        { status: 422 },
      ),
    );
    expect(await resetPassword("bad", "new-pass-123")).toEqual({
      kind: "failure",
      reason: "invalid_reset_token",
    });
  });
});

describe("account unlock", () => {
  test("request posts the address with the locale, confirm posts the token", async () => {
    const seen = stubFetch(() => jsonResponse({ isSuccess: true }));
    expect(await requestAccountUnlock("a@b.de", { locale: "de" })).toEqual({
      kind: "success",
      data: undefined,
    });
    expect(await confirmAccountUnlock("tok")).toEqual({ kind: "success", data: undefined });
    expect(seen[0]?.url).toBe("/api/auth/request-account-unlock");
    expect(sentBody(seen[0])).toEqual({ email: "a@b.de" });
    expect(seen[0]?.init?.headers).toMatchObject({ "X-Locale": "de" });
    expect(seen[1]?.url).toBe("/api/auth/confirm-account-unlock");
    expect(sentBody(seen[1])).toEqual({ token: "tok" });
  });

  test("a rejected unlock token is a failure with the server's reason", async () => {
    stubFetch(() =>
      jsonResponse(
        { error: { code: "unprocessable", details: { reason: "invalid_unlock_token" } } },
        { status: 422 },
      ),
    );
    expect(await confirmAccountUnlock("bad")).toEqual({
      kind: "failure",
      reason: "invalid_unlock_token",
    });
  });
});

describe("invitations", () => {
  test("fetchInviteInfo returns email and hasAccount", async () => {
    const seen = stubFetch(() => jsonResponse({ email: "i@x.de", hasAccount: true }));
    expect(await fetchInviteInfo("t")).toEqual({
      kind: "success",
      data: { email: "i@x.de", hasAccount: true },
    });
    expect(seen[0]?.url).toBe("/api/auth/invite-info");
  });

  test("fetchInviteInfo rejects a malformed body", async () => {
    stubFetch(() => jsonResponse({ email: 1 }));
    expect(await fetchInviteInfo("t")).toMatchObject({ kind: "failure" });
  });

  test("each accept branch posts its own route and payload", async () => {
    const seen = stubFetch(() => jsonResponse({ tenantId: "ten", role: "Editor" }));
    await acceptInviteSignedIn("t");
    await acceptInviteWithLogin("t", "a@b.de", "pw");
    await acceptInviteWithNewAccount("t", "pw");
    expect(seen.map((s) => s.url)).toEqual([
      "/api/auth/invite-accept",
      "/api/auth/invite-accept-with-login",
      "/api/auth/invite-signup-complete",
    ]);
    expect(sentBody(seen[1])).toEqual({ token: "t", email: "a@b.de", password: "pw" });
    expect(sentBody(seen[2])).toEqual({ token: "t", password: "pw" });
  });

  test("accepted carries tenant, session roles and only a safe landing path", async () => {
    stubFetch(() =>
      jsonResponse({
        tenantId: "ten",
        role: "Editor",
        user: { roles: ["Editor", "Member"] },
        landingPath: "/ten/home",
      }),
    );
    expect(await acceptInviteWithNewAccount("t", "pw")).toEqual({
      kind: "success",
      data: {
        status: "accepted",
        tenantId: "ten",
        roles: ["Editor", "Member"],
        landingPath: "/ten/home",
      },
    });
    stubFetch(() =>
      jsonResponse({ tenantId: "ten", role: "Editor", landingPath: "https://evil.example" }),
    );
    expect(await acceptInviteWithNewAccount("t", "pw")).toEqual({
      kind: "success",
      data: { status: "accepted", tenantId: "ten", roles: ["Editor"] },
    });
  });

  test("an MFA gate answers 200 without a tenant: mfa-pending", async () => {
    stubFetch(() => jsonResponse({ mfaRequired: true }));
    expect(await acceptInviteWithLogin("t", "a@b.de", "pw")).toEqual({
      kind: "success",
      data: { status: "mfa-pending" },
    });
  });

  test("a bad invitation is a failure", async () => {
    stubFetch(() => jsonResponse({ error: { code: "invalid_invite_token" } }, { status: 422 }));
    expect(await acceptInviteWithNewAccount("t", "pw")).toEqual({
      kind: "failure",
      reason: "invalid_invite_token",
    });
  });
});

describe("logout", () => {
  test("posts an empty body to the logout route", async () => {
    const seen = stubFetch(() => jsonResponse({ isSuccess: true }));
    expect(await logout({ locale: "de" })).toEqual({ kind: "success", data: undefined });
    expect(seen[0]?.url).toBe("/api/auth/logout");
    expect(sentBody(seen[0])).toEqual({});
  });
});
