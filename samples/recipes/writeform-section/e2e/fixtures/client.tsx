// Browser entry for writeform-section/e2e. Fetches the server-built
// AppSchema (see build-server.ts — built from the real src/feature.ts, not
// duplicated here) and mounts createKumikoApp with the MockDispatcher.
//
// screenQn points at note-edit, the established entityEdit screen — it's
// openToAll, so no explicit user/role is needed.
//
// The `shell` renders the entityEdit screen (passed in as `children`) next
// to a second, independently mounted `note-detail` projectionDetail screen
// (its writeForm section) — that's what makes the layout-parity comparison
// between the two form kinds possible in one page load. Per
// packages/renderer-web/src/app/create-app.tsx, shell renders inside every
// provider createKumikoApp sets up (dispatcher, primitives, locale, nav,
// tokens), so the second KumikoScreen works without any provider of its own.

import type { AppSchema } from "@cosmicdrift/kumiko-renderer";
import { createKumikoApp, KumikoScreen } from "@cosmicdrift/kumiko-renderer-web";
import type { ReactNode } from "react";
import { createMockDispatcher } from "./mock-dispatcher";

const NOTE_EDIT_SCREEN_QN = "note-desk:screen:note-edit";
const NOTE_DETAIL_SCREEN_QN = "note-desk:screen:note-detail";

function SideBySideShell({
  children,
  schema,
}: {
  readonly children: ReactNode;
  readonly schema: AppSchema;
}): ReactNode {
  const feature = schema.features[0];
  return (
    <div data-testid="side-by-side" className="grid grid-cols-2 gap-6 p-6 items-start">
      <div data-testid="established-form">{children}</div>
      <div data-testid="write-form-screen">
        {feature !== undefined && (
          <KumikoScreen schema={feature} qn={NOTE_DETAIL_SCREEN_QN} entityId="note-1" />
        )}
      </div>
    </div>
  );
}

async function boot(): Promise<void> {
  const root = document.getElementById("root");
  if (root === null) throw new Error("writeform-section/e2e: #root not found");

  const response = await fetch("/schema.json");
  if (!response.ok) {
    throw new Error(`writeform-section/e2e: /schema.json fetch failed with ${response.status}`);
  }
  const schema = (await response.json()) as AppSchema;

  createKumikoApp({
    schema,
    dispatcher: createMockDispatcher(),
    shell: SideBySideShell,
    screenQn: NOTE_EDIT_SCREEN_QN,
  });
}

boot().catch((error: unknown) => {
  // A rejected boot() would otherwise become a silent unhandled rejection —
  // surface it in the DOM so a failing e2e run shows the real cause instead
  // of a blank #root.
  const root = document.getElementById("root");
  if (root !== null) {
    root.textContent = `writeform-section/e2e: boot failed — ${String(error)}`;
  }
  throw error;
});
