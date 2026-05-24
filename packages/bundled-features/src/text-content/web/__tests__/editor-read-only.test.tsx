import {
  createStaticLocaleResolver,
  LocaleProvider,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer-web";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, mock, test } from "bun:test";
import { textContentClient } from "../client-plugin";

// mock.module eretzt imports für alle Konsumenten — statische imports
// vor mock.module sehen die gemockte Version weil Bun am Loader-Level
// intercepted. useShellUser ist hier ein Mock-Objekt.
import { useShellUser } from "@cosmicdrift/kumiko-bundled-features/auth-email-password/web";

mock.module("@cosmicdrift/kumiko-bundled-features/auth-email-password/web", () => ({
  useShellUser: mock(),
}));

const actual_renderer = await import("@cosmicdrift/kumiko-renderer");
mock.module("@cosmicdrift/kumiko-renderer", () => ({
  ...actual_renderer,
  useDispatcher: mock(() => ({
    write: mock(),
    query: mock(),
  })),
  useQuery: mock(() => ({
    data: { slug: "imprint", lang: "de", title: "Impressum", body: "Inhalt" },
    loading: false,
    error: null,
    refetch: mock(),
  })),
}));

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
    useShellUser.mockReturnValue({ id: "u1", roles: ["TenantAdmin"] });
    const Editor = getEditor();
    render(<Editor target={TARGET} onClose={() => {}} />, { wrapper: Wrapper });

    const saveButton = screen.getByRole("button", { name: /speichern/i });
    expect(saveButton).toBeTruthy();
    expect(saveButton.hasAttribute("disabled")).toBe(false);

    expect(screen.queryByText(/Read-only/)).toBeNull();
  });

  test("SystemAdmin sieht Save-Button (alternative write-role)", () => {
    useShellUser.mockReturnValue({ id: "u1", roles: ["SystemAdmin"] });
    const Editor = getEditor();
    render(<Editor target={TARGET} onClose={() => {}} />, { wrapper: Wrapper });

    expect(screen.getByRole("button", { name: /speichern/i })).toBeTruthy();
    expect(screen.queryByText(/Read-only/)).toBeNull();
  });

  test("Editor-Role sieht Read-only-Banner + KEIN Save-Button", () => {
    useShellUser.mockReturnValue({ id: "u1", roles: ["Editor"] });
    const Editor = getEditor();
    render(<Editor target={TARGET} onClose={() => {}} />, { wrapper: Wrapper });

    expect(screen.getByText(/Read-only/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^speichern/i })).toBeNull();
  });

  test("Admin-Role (publicstatus-Convention, ohne TenantAdmin-dual-Tag) sieht Read-only-Banner", () => {
    useShellUser.mockReturnValue({ id: "u1", roles: ["Admin"] });
    const Editor = getEditor();
    render(<Editor target={TARGET} onClose={() => {}} />, { wrapper: Wrapper });

    expect(screen.getByText(/Read-only/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^speichern/i })).toBeNull();
  });

  test("Logged-out (useShellUser=undefined) sieht Read-only-Banner", () => {
    useShellUser.mockReturnValue(undefined);
    const Editor = getEditor();
    render(<Editor target={TARGET} onClose={() => {}} />, { wrapper: Wrapper });

    expect(screen.getByText(/Read-only/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^speichern/i })).toBeNull();
  });
});
