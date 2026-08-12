// Browser entry for wizard-form/e2e. Fetches the server-built AppSchema
// (see build-server.ts — built from the real src/feature.ts, not
// duplicated here) and mounts createKumikoApp with the MockDispatcher.
//
// screenQn points explicitly at the wizard screen: the only screen in
// this schema requires roles: ["Admin", "User"] (no openToAll screen
// exists), createKumikoApp would throw at boot without an explicit
// screenQn ("no screen reachable without role restriction"). The
// DefaultAppShell `user` prop supplies the role that screenAccessAllows
// checks client-side.
//
// ListingReviewSection is the REAL review component from src/web/ — only
// registered via clientFeatures.extensionSectionComponents, never
// imported directly from feature.ts (keeps the server/client split
// intact).

import type { AppSchema } from "@cosmicdrift/kumiko-renderer";
import { createKumikoApp, DefaultAppShell } from "@cosmicdrift/kumiko-renderer-web";
import type { ReactNode } from "react";
import { ListingReviewSection } from "../../src/web/listing-review-section";
import { createMockDispatcher } from "./mock-dispatcher";

const WIZARD_SCREEN_QN = "listings:screen:listing-wizard";
const E2E_USER = { id: "e2e-user", roles: ["Admin"] };

function Brand(): ReactNode {
  return <strong className="text-foreground tracking-tight">Wizard Form E2E</strong>;
}

function AppShell({
  children,
  schema,
}: {
  readonly children: ReactNode;
  readonly schema: AppSchema;
}): ReactNode {
  return (
    <DefaultAppShell brand={<Brand />} schema={schema} user={E2E_USER}>
      {children}
    </DefaultAppShell>
  );
}

async function boot(): Promise<void> {
  const root = document.getElementById("root");
  if (root === null) throw new Error("wizard-form/e2e: #root not found");

  const response = await fetch("/schema.json");
  if (!response.ok) {
    throw new Error(`wizard-form/e2e: /schema.json fetch failed with ${response.status}`);
  }
  const schema = (await response.json()) as AppSchema;

  createKumikoApp({
    schema,
    dispatcher: createMockDispatcher(),
    shell: AppShell,
    screenQn: WIZARD_SCREEN_QN,
    clientFeatures: [
      {
        name: "wizard-form-e2e",
        extensionSectionComponents: { ListingReviewSection },
      },
    ],
  });
}

boot().catch((error: unknown) => {
  // A rejected boot() would otherwise become a silent unhandled rejection —
  // surface it in the DOM so a failing e2e run shows the real cause instead
  // of a blank #root.
  const root = document.getElementById("root");
  if (root !== null) {
    root.textContent = `wizard-form/e2e: boot failed — ${String(error)}`;
  }
  throw error;
});
