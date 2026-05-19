// @vitest-environment jsdom

import {
  createStaticLocaleResolver,
  LocaleProvider,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer-web";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, test, vi } from "vitest";
import { textContentClient } from "../client-plugin";

// Mock-Setup für die drei externen Hooks die TextContentEditor benutzt.
// vi.mock + vi.fn() erlaubt pro-Test verschiedene Roles + Dispatcher-
// Antworten. Memory `[Keine Fake-Tests]`: wir testen echtes Rendering,
// nicht nur die canWrite-Bedingung.
vi.mock("@cosmicdrift/kumiko-bundled-features/auth-email-password/web", () => ({
  useShellUser: vi.fn(),
}));

vi.mock("@cosmicdrift/kumiko-renderer", async () => {
  const actual = await vi.importActual<typeof import("@cosmicdrift/kumiko-renderer")>(
    "@cosmicdrift/kumiko-renderer",
  );
  return {
    ...actual,
    useDispatcher: vi.fn(() => ({
      write: vi.fn(),
      query: vi.fn(),
    })),
    useQuery: vi.fn(() => ({
      data: { slug: "imprint", lang: "de", title: "Impressum", body: "Inhalt" },
      loading: false,
      error: null,
      refetch: vi.fn(),
    })),
  };
});

import { useShellUser } from "@cosmicdrift/kumiko-bundled-features/auth-email-password/web";

const TARGET = {
  featureId: "text-content",
  action: "edit",
  args: { slug: "imprint", lang: "de" },
} as const;

function getEditor() {
  const def = textContentClient();
  const Editor = def.resolvers?.["text-content:edit"];
  if (!Editor) throw new Error("Editor not registered");
  return Editor;
}

const localeResolver = createStaticLocaleResolver();

function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <LocaleProvider resolver={localeResolver}>
      <PrimitivesProvider value={defaultPrimitives}>{children}</PrimitivesProvider>
    </LocaleProvider>
  );
}

describe("TextContentEditor — role-based write-access", () => {
  test("TenantAdmin sieht Save-Button + editable inputs", () => {
    vi.mocked(useShellUser).mockReturnValue({ id: "u1", roles: ["TenantAdmin"] });
    const Editor = getEditor();
    render(<Editor target={TARGET} onClose={() => {}} />, { wrapper: Wrapper });

    // Save-Button gerendert (canWrite=true → Button.type=submit)
    const saveButton = screen.getByRole("button", { name: /speichern/i });
    expect(saveButton).toBeTruthy();
    expect(saveButton.hasAttribute("disabled")).toBe(false);

    // Read-only-Banner darf NICHT erscheinen
    expect(screen.queryByText(/Read-only/)).toBeNull();
  });

  test("SystemAdmin sieht Save-Button (alternative write-role)", () => {
    vi.mocked(useShellUser).mockReturnValue({ id: "u1", roles: ["SystemAdmin"] });
    const Editor = getEditor();
    render(<Editor target={TARGET} onClose={() => {}} />, { wrapper: Wrapper });

    expect(screen.getByRole("button", { name: /speichern/i })).toBeTruthy();
    expect(screen.queryByText(/Read-only/)).toBeNull();
  });

  test("Editor-Role sieht Read-only-Banner + KEIN Save-Button", () => {
    // Das ist der advisor-flagged Pfad — bisher unverifiziert. Editor-
    // Role hat in publicstatus's Schema Zugriff auf visual-Workspace +
    // by-slug-query (read), aber NICHT auf set.write. UI muss das
    // explizit kommunizieren statt 403 erst beim save zu zeigen.
    vi.mocked(useShellUser).mockReturnValue({ id: "u1", roles: ["Editor"] });
    const Editor = getEditor();
    render(<Editor target={TARGET} onClose={() => {}} />, { wrapper: Wrapper });

    expect(screen.getByText(/Read-only/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^speichern/i })).toBeNull();
  });

  test("Admin-Role (publicstatus-Convention, ohne TenantAdmin-dual-Tag) sieht Read-only-Banner", () => {
    // Apps die NUR `Admin` (ohne `TenantAdmin`) im JWT haben, kriegen
    // read-only. Dokumentiert das Dual-Role-Pattern aus publicstatus:
    // wer "Admin" allein hat (Memory `[Role-Naming-Drift]`), muss
    // explizit auch "TenantAdmin" im JWT tragen damit der Editor
    // schreiben darf.
    vi.mocked(useShellUser).mockReturnValue({ id: "u1", roles: ["Admin"] });
    const Editor = getEditor();
    render(<Editor target={TARGET} onClose={() => {}} />, { wrapper: Wrapper });

    expect(screen.getByText(/Read-only/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^speichern/i })).toBeNull();
  });

  test("Logged-out (useShellUser=undefined) sieht Read-only-Banner", () => {
    vi.mocked(useShellUser).mockReturnValue(undefined);
    const Editor = getEditor();
    render(<Editor target={TARGET} onClose={() => {}} />, { wrapper: Wrapper });

    expect(screen.getByText(/Read-only/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^speichern/i })).toBeNull();
  });
});
