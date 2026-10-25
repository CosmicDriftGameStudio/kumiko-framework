// Browser entry for renderer/e2e. Routes by window.location.pathname:
//   /combobox  → standalone ComboboxInput test page (reproduce the browser reality
//                of the mouse-click bug without an AppSchema)
//   /date      → DateInput
//   /money     → MoneyInput
//   /signup    → SignupScreen via createPublicSurface (auth e2e)
//   /mfa-verify → MfaVerifyScreen via createPublicSurface (auth e2e)
//   otherwise  → createKumikoApp with MockDispatcher (standard smoke suite)

import { createKumikoApp, DefaultAppShell } from "@cosmicdrift/kumiko-renderer/web";
import { type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ComboboxTestPage } from "./combobox-page";
import { DateTestPage } from "./date-page";
import { TestIdentityProvider } from "./identity-provider";
import { createMockDispatcher } from "./mock-dispatcher";
import { MoneyTestPage } from "./money-page";
import { BOOM_SCREEN_ID, e2eSchema } from "./schema";

// Write controls a spec sets with addInitScript before boot and reads back afterwards.
type WriteControlWindow = Window & {
  __E2E_REJECT_WRITE_IDS__?: readonly string[];
  __E2E_HOLD_WRITES__?: boolean;
  __E2E_WRITE_LOG__?: readonly string[];
  __E2E_RELEASE_WRITES__?: () => void;
};

function mountReact(node: ReactNode): void {
  const root = document.getElementById("root");
  if (root === null) throw new Error("renderer/e2e: #root not found");
  createRoot(root).render(<StrictMode>{node}</StrictMode>);
}
function BoomScreen(): ReactNode {
  throw new Error("e2e-screen-boom");
}

function CrashingProvider(): ReactNode {
  throw new Error("e2e-provider-boom");
}

async function boot(): Promise<void> {
  const path = window.location.pathname;

  if (path.startsWith("/combobox")) {
    mountReact(<ComboboxTestPage />);
    return;
  }

  if (path.startsWith("/date")) {
    mountReact(<DateTestPage />);
    return;
  }

  if (path.startsWith("/money")) {
    mountReact(<MoneyTestPage />);
    return;
  }

  if (path.startsWith("/signup")) {
    // Dynamic import keeps the auth graph out of the default smoke bundle
    // and avoids Bun DCE when folding pathname at build time.
    await import("./signup-page");
    return;
  }

  if (path.startsWith("/mfa-verify")) {
    await import("./mfa-verify-page");
    return;
  }

  const controlWindow: WriteControlWindow = window;
  const dispatcher = createMockDispatcher({
    ...(controlWindow.__E2E_REJECT_WRITE_IDS__ !== undefined && {
      rejectWriteIds: controlWindow.__E2E_REJECT_WRITE_IDS__,
    }),
    holdWrites: controlWindow.__E2E_HOLD_WRITES__ === true,
    // Test pages can feed pre-data via window.__E2E_SEED__ before boot;
    // without a seed every test starts with an empty in-memory DB.
    seed: ((globalThis as { __E2E_SEED__?: Record<string, unknown[]> }).__E2E_SEED__ ??
      {}) as Record<string, readonly { id: string; [key: string]: unknown }[]>,
  });

  controlWindow.__E2E_WRITE_LOG__ = dispatcher.writeLog;
  controlWindow.__E2E_RELEASE_WRITES__ = dispatcher.releaseWrites;

  const Brand = (): ReactNode => (
    <strong className="text-foreground tracking-tight">Renderer-Web E2E</strong>
  );

  const AppShell = ({
    children,
    schema,
  }: {
    readonly children: ReactNode;
    readonly schema: typeof e2eSchema;
  }): ReactNode => (
    <DefaultAppShell brand={<Brand />} schema={schema}>
      {children}
    </DefaultAppShell>
  );

  createKumikoApp({
    schema: e2eSchema,
    dispatcher,
    shell: AppShell,
    clientFeatures: [
      {
        name: "test",
        components: { [BOOM_SCREEN_ID]: BoomScreen },
        providers: [
          TestIdentityProvider,
          ...(new URLSearchParams(window.location.search).has("crash-root")
            ? [CrashingProvider]
            : []),
        ],
      },
    ],
  });
}

boot().catch((error: unknown) => {
  // A rejected boot() (e.g. a failed dynamic import) would otherwise become
  // a silent unhandled rejection — surface it in the DOM so a screenshot/
  // page-content assertion in a failing e2e run shows the real cause
  // instead of a blank #root.
  const root = document.getElementById("root");
  if (root !== null) {
    root.textContent = `renderer/e2e: boot failed — ${String(error)}`;
  }
  throw error;
});
