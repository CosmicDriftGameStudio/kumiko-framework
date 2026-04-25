// Shared fixtures for session-related integration tests. Centralises the
// seed/login/request helpers while keeping per-suite state (stack, tenantId)
// explicit in the call site.
//
// Usage:
//   const h = makeSessionHelpers(stack, TENANT);
//   await h.seedUser("x@example.com", "pw");
//   const { token, sid } = await h.login("x@example.com", "pw");
//   const res = await h.authedPost("/api/query", token, { type, payload });

import type { TenantId } from "@kumiko/framework/engine";
import { type TestStack, TestUsers } from "@kumiko/framework/testing";
import * as jose from "jose";
import { expect } from "vitest";
import { hashPassword } from "../../auth-email-password/password-hashing";
import { seedTenantMembership } from "../../tenant/seeding";
import { UserHandlers } from "../../user";

export type LoginResult = {
  readonly token: string;
  readonly sid: string;
};

// Return type is inferred from the factory so callers just use
// `ReturnType<typeof makeSessionHelpers>` — no separate type export to
// keep in sync with the implementation. Params are typed inline on each
// method so the inference is sharp.
export function makeSessionHelpers(stack: TestStack, tenantId: TenantId) {
  return {
    async seedUser(
      email: string,
      password: string,
      opts?: { roles?: readonly string[] },
    ): Promise<{ userId: string }> {
      const hash = await hashPassword(password);
      const created = await stack.http.writeOk<{ id: string }>(
        UserHandlers.create,
        { email, passwordHash: hash, displayName: email.split("@")[0] ?? "u" },
        TestUsers.systemAdmin,
      );
      await seedTenantMembership(stack.db, {
        userId: created.id,
        tenantId,
        roles: opts?.roles ?? ["User"],
      });
      return { userId: created.id };
    },

    async login(email: string, password: string): Promise<LoginResult> {
      const res = await stack.http.raw("POST", "/api/auth/login", { email, password });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { token: string };
      const payload = jose.decodeJwt(body.token);
      const sid = payload.jti;
      if (typeof sid !== "string") {
        throw new Error("login did not emit a sid — is sessions wired?");
      }
      return { token: body.token, sid };
    },

    /** POST with `Authorization: Bearer ${token}`. Body is JSON-serialised. */
    authedPost(path: string, token: string, body?: unknown): Promise<Response> {
      return stack.http.raw("POST", path, body, { Authorization: `Bearer ${token}` });
    },
  };
}
