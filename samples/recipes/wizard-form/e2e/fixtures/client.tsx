// Browser-Entry für wizard-form/e2e. Fetched das server-built AppSchema
// (siehe build-server.ts — gebaut aus dem echten src/feature.ts, nicht
// hier dupliziert) und mounted createKumikoApp mit dem MockDispatcher.
//
// screenQn zeigt explizit auf den Wizard-Screen: die einzige Screen in
// diesem Schema verlangt roles: ["Admin", "User"] (kein openToAll-Screen
// existiert), createKumikoApp würde ohne expliziten screenQn beim Boot
// werfen ("kein Screen ohne role-restriction erreichbar"). Der
// DefaultAppShell `user`-Prop liefert die Rolle, die screenAccessAllows
// client-seitig prüft.
//
// ListingReviewSection ist die ECHTE Review-Component aus src/web/ — nur
// über clientFeatures.extensionSectionComponents registriert, nie direkt
// von feature.ts importiert (die Server/Client-Trennung bleibt intakt).

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
