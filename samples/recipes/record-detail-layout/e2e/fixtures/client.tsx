// Browser entry for record-detail-layout/e2e (fw#2778). Fetches the
// server-built AppSchema (built from the real src/feature.ts, see
// build-server.ts) and mounts createKumikoApp with the MockDispatcher.
//
// Pattern copied from writeform-section/e2e/fixtures/client.tsx: the shell
// renders its own explicitly-keyed KumikoScreen (entityId="order-1") instead
// of createKumikoApp's routed `children` — that's the only way to pin a
// projectionDetail screen's entityId without forking the URL-routing
// internals. `screenQn` is still required (createKumikoApp throws without a
// resolvable initial route), but the routed content it produces is unused.
//
// DefaultAppShell wraps the screen in the same viewport-height chrome
// (`h-svh` shell, `main` scrolls internally) a real app gives it — the
// fillHeight/scrollBody chain under test only resolves against a genuinely
// height-constrained ancestor, not document-flow. `user` grants the
// "Admin" role order-detail's screen access requires.
//
// order-detail is a projectionDetail screen in `layout.mode: "tabs"` — the
// first tab ("items", a relatedList section) is active by default (no `tab`
// search param), which is exactly the fw#2778 scenario: a lone relatedList
// tab that must size to its content when short and scroll internally when
// long, instead of stretching the tab panel to the bottom.

import type { AppSchema } from "@cosmicdrift/kumiko-renderer";
import { createKumikoApp, DefaultAppShell, KumikoScreen } from "@cosmicdrift/kumiko-renderer-web";
import type { ReactNode } from "react";
import { createMockDispatcher } from "./mock-dispatcher";

const ORDER_DETAIL_SCREEN_QN = "order-desk:screen:order-detail";

function Shell({
  schema,
}: {
  readonly children: ReactNode;
  readonly schema: AppSchema;
}): ReactNode {
  const feature = schema.features[0];
  // KumikoScreen sits directly under DefaultAppShell's <main> — same as the
  // real RoutedScreen (create-app.tsx) — so RenderEdit's `fillHeight` chain
  // (h-full all the way down) resolves against `main`'s own, genuinely
  // height-constrained box. A wrapper div here without its own h-full would
  // break that percentage-height chain at the very first link.
  return (
    <DefaultAppShell
      brand={<span>Order Desk</span>}
      schema={schema}
      user={{ id: "u1", roles: ["Admin"] }}
    >
      {feature !== undefined && (
        <KumikoScreen schema={feature} qn={ORDER_DETAIL_SCREEN_QN} entityId="order-1" />
      )}
    </DefaultAppShell>
  );
}

async function boot(): Promise<void> {
  const root = document.getElementById("root");
  if (root === null) throw new Error("record-detail-layout/e2e: #root not found");

  const response = await fetch("/schema.json");
  if (!response.ok) {
    throw new Error(`record-detail-layout/e2e: /schema.json fetch failed with ${response.status}`);
  }
  const schema = (await response.json()) as AppSchema;

  createKumikoApp({
    schema,
    dispatcher: createMockDispatcher(),
    shell: Shell,
    screenQn: ORDER_DETAIL_SCREEN_QN,
  });
}

boot().catch((error: unknown) => {
  const root = document.getElementById("root");
  if (root !== null) {
    root.textContent = `record-detail-layout/e2e: boot failed — ${String(error)}`;
  }
  throw error;
});
