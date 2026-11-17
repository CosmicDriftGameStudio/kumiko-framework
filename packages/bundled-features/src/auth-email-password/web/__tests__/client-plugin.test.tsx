import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { mockModuleForFile } from "@cosmicdrift/kumiko-testing/helpers/mock-module";

// emailPasswordClient() built the session gate without threading
// options.mfaSetupScreen through to makeSessionAuthGate — the option was
// typed and documented but silently dropped on the standard mount path.
// makeSessionAuthGate wraps its own real SessionProvider (unlike
// makeAuthGate, which auth-gate.test.tsx exercises directly), so the
// cheapest live check is spying on the call args instead of rendering
// through a real session fetch.
// mock.module is process-wide in bun, so a stub would replace the gate for every
// DOM test file in the same run; the spy records and delegates to the real module.
const realAuthGate = { ...(await import("../auth-gate.tsx")) };
const makeSessionAuthGateCalls: unknown[][] = [];
mockModuleForFile(fileURLToPath(new URL("../auth-gate.tsx", import.meta.url)), realAuthGate, {
  makeSessionAuthGate: (...args: Parameters<typeof realAuthGate.makeSessionAuthGate>) => {
    makeSessionAuthGateCalls.push(args);
    return realAuthGate.makeSessionAuthGate(...args);
  },
});

const { emailPasswordClient } = await import("../client-plugin.ts");
const { ForgotPasswordScreen } = await import("../forgot-password-screen.tsx");
const { renderWithProviders } = await import("./test-utils.tsx");

function CustomMfaSetup() {
  return null;
}

describe("emailPasswordClient — mfaSetupScreen wiring", () => {
  test("passes options.mfaSetupScreen through to makeSessionAuthGate", () => {
    makeSessionAuthGateCalls.length = 0;

    emailPasswordClient({ mfaSetupScreen: CustomMfaSetup });

    expect(makeSessionAuthGateCalls).toHaveLength(1);
    expect((makeSessionAuthGateCalls[0]?.[0] as { mfaSetupScreen?: unknown })?.mfaSetupScreen).toBe(
      CustomMfaSetup,
    );
  });
});

describe("emailPasswordClient — authShell", () => {
  test("authShell mounts one provider that wraps the auth cards", () => {
    const client = emailPasswordClient({
      authShell: (card) => <div data-testid="brand-shell">{card}</div>,
    });
    expect(client.providers).toHaveLength(1);
    const [Provider] = client.providers;
    if (!Provider) throw new Error("expected a provider");
    const ui = renderWithProviders(
      <Provider>
        <ForgotPasswordScreen />
      </Provider>,
    );
    ui.getByTestId("brand-shell");
  });

  test("without authShell there is no provider", () => {
    expect(emailPasswordClient().providers).toHaveLength(0);
  });
});
