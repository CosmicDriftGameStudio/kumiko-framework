// Browser-Entry für renderer-web/e2e. Routet nach window.location.pathname:
//   /combobox  → standalone ComboboxInput-Test-Page (Browser-Reality
//                des Mouse-Click-Bugs reproduzieren ohne AppSchema)
//   /date      → DateInput
//   /signup    → SignupScreen via createPublicSurface (auth e2e)
//   sonst      → createKumikoApp mit MockDispatcher (Standard-Smoke-Suite)

import { createKumikoApp, DefaultAppShell } from "@cosmicdrift/kumiko-renderer-web";
import { type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ComboboxTestPage } from "./combobox-page";
import { DateTestPage } from "./date-page";
import { createMockDispatcher } from "./mock-dispatcher";
import { e2eSchema } from "./schema";

async function boot(): Promise<void> {
  const path = window.location.pathname;

  if (path.startsWith("/combobox")) {
    const root = document.getElementById("root");
    if (root === null) throw new Error("renderer-web/e2e: #root not found");
    createRoot(root).render(
      <StrictMode>
        <ComboboxTestPage />
      </StrictMode>,
    );
    return;
  }

  if (path.startsWith("/date")) {
    const root = document.getElementById("root");
    if (root === null) throw new Error("renderer-web/e2e: #root not found");
    createRoot(root).render(
      <StrictMode>
        <DateTestPage />
      </StrictMode>,
    );
    return;
  }

  if (path.startsWith("/signup")) {
    // Dynamic import keeps the auth graph out of the default smoke bundle
    // and avoids Bun DCE when folding pathname at build time.
    await import("./signup-page");
    return;
  }

  const dispatcher = createMockDispatcher({
    // Test-Pages können vor dem Boot via window.__E2E_SEED__ Pre-Daten
    // einfüttern; ohne Seed startet jeder Test mit leerer In-Memory-DB.
    seed: ((globalThis as { __E2E_SEED__?: Record<string, unknown[]> }).__E2E_SEED__ ??
      {}) as Record<string, readonly { id: string; [key: string]: unknown }[]>,
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
}

void boot();
