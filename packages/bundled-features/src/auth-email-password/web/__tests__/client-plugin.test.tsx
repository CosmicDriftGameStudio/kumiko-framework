import { describe, expect, mock, test } from "bun:test";

// #1472: emailPasswordClient() built the session gate without threading
// options.mfaSetupScreen through to makeSessionAuthGate — the option was
// typed and documented but silently dropped on the standard mount path.
// makeSessionAuthGate wraps its own real SessionProvider (unlike
// makeAuthGate, which auth-gate.test.tsx exercises directly), so the
// cheapest live check is spying on the call args instead of rendering
// through a real session fetch.
// mock.module is process-wide in bun, so a stub would replace the gate for every
// DOM test file in the same run; the spy records and delegates to the real module.
const realAuthGate = { ...(await import("../auth-gate.js")) };
const makeSessionAuthGateCalls: unknown[][] = [];
mock.module("../auth-gate", () => ({
  ...realAuthGate,
  makeSessionAuthGate: (...args: Parameters<typeof realAuthGate.makeSessionAuthGate>) => {
    makeSessionAuthGateCalls.push(args);
    return realAuthGate.makeSessionAuthGate(...args);
  },
}));

const { emailPasswordClient } = await import("../client-plugin.js");

describe("emailPasswordClient — mfaSetupScreen wiring", () => {
  test("passes options.mfaSetupScreen through to makeSessionAuthGate", () => {
    makeSessionAuthGateCalls.length = 0;
    function CustomMfaSetup() {
      return null;
    }

    emailPasswordClient({ mfaSetupScreen: CustomMfaSetup });

    expect(makeSessionAuthGateCalls).toHaveLength(1);
    expect((makeSessionAuthGateCalls[0]?.[0] as { mfaSetupScreen?: unknown })?.mfaSetupScreen).toBe(
      CustomMfaSetup,
    );
  });
});
