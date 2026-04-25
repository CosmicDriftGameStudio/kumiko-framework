// Browser-Entry für renderer-web/e2e. Mountet createKumikoApp mit
// MockDispatcher statt createLiveDispatcher — keine HTTP-Layer, kein
// Auth, kein Schema-Injection. Reine Renderer-Surface gegen
// In-Memory-State.

import { createKumikoApp, DefaultAppShell } from "@kumiko/renderer-web";
import type { ReactNode } from "react";
import { createMockDispatcher } from "./mock-dispatcher";
import { e2eSchema } from "./schema";

const dispatcher = createMockDispatcher({
  // Test-Pages können vor dem Boot via window.__E2E_SEED__ Pre-Daten
  // einfüttern; ohne Seed startet jeder Test mit leerer In-Memory-DB.
  seed: ((globalThis as { __E2E_SEED__?: Record<string, unknown[]> }).__E2E_SEED__ ?? {}) as Record<
    string,
    readonly { id: string; [key: string]: unknown }[]
  >,
});

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
});
