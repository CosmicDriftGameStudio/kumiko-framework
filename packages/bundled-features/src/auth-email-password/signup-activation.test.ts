import { describe, expect, test } from "bun:test";
import { createRecordingRedisFake } from "../shared/__tests__/recording-redis-fake.js";
import { issueSignupActivation, SIGNUP_ACTIVATION_NOTIFICATION_TYPE } from "./signup-activation.js";
import { SIGNUP_TOKEN_KEY_PREFIXES } from "./signup-token-store.js";

describe("issueSignupActivation", () => {
  test("stores the token under the signup prefixes and mails the activation link to the normalized email", async () => {
    const { redis, calls } = createRecordingRedisFake({
      set: "OK",
      get: null,
      del: 1,
      mget: [],
      incr: 1,
      expire: 1,
    });
    const notifications: { type: string; email: string | undefined; data: unknown }[] = [];
    const afterStore: string[] = [];

    const issued = await issueSignupActivation({
      redis,
      notify: async (type, args) => {
        notifications.push({ type, email: args.route?.["email"], data: args.data });
        return { deliveries: [] };
      },
      email: "User@Example.com",
      appUrl: "https://app.example.com/activate",
      onTokenStored: async ({ token }) => {
        afterStore.push(token);
      },
    });

    expect(issued.email).toBe("user@example.com");
    expect(afterStore).toEqual([issued.token]);
    const setKeys = calls.filter((call) => call.method === "set").map((call) => call.args[0]);
    expect(setKeys).toContain(`${SIGNUP_TOKEN_KEY_PREFIXES.email}user@example.com`);
    expect(setKeys.some((key) => String(key).startsWith(SIGNUP_TOKEN_KEY_PREFIXES.token))).toBe(
      true,
    );
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.type).toBe(SIGNUP_ACTIVATION_NOTIFICATION_TYPE);
    expect(notifications[0]?.email).toBe("user@example.com");
    expect(JSON.stringify(notifications[0]?.data)).toContain(encodeURIComponent(issued.token));
  });
});
