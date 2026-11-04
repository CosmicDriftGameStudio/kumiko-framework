import { describe, expect, mock, test } from "bun:test";
// mock.module replaces imports for all consumers — static imports
// before mock.module still see the mocked version because Bun
// intercepts at the loader level. useShellUser is a mock object here.
import { useShellUser } from "@cosmicdrift/kumiko-bundled-features/auth-email-password/web";
import {
  createStaticLocaleResolver,
  kumikoDefaultTranslations,
  LocaleProvider,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer/web";
import { mockModuleForFile } from "@cosmicdrift/kumiko-testing/helpers/mock-module";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { textBlocksClient } from "../client-plugin.tsx";
import { defaultTranslations } from "../i18n.ts";

const LOADED_RESULT = {
  data: {
    slug: "imprint",
    locale: "de",
    title: "Impressum",
    content: "Inhalt",
    contentFormat: "plain",
    folder: "legal",
  },
  loading: false,
  error: null,
  refetch: mock(),
};

mockModuleForFile(
  "@cosmicdrift/kumiko-bundled-features/auth-email-password/web",
  await import("@cosmicdrift/kumiko-bundled-features/auth-email-password/web"),
  {
    useShellUser: mock(),
  },
);

mockModuleForFile("@cosmicdrift/kumiko-renderer", await import("@cosmicdrift/kumiko-renderer"), {
  useDispatcher: mock(),
  // Stable result object like the real hook: a fresh one per render would re-run the editor's
  // load sync and overwrite what the test typed.
  useQuery: mock(() => LOADED_RESULT),
});

const { useDispatcher } = await import("@cosmicdrift/kumiko-renderer");

const TARGET = {
  featureId: "template-resolver",
  action: "edit",
  args: { slug: "imprint", locale: "de" },
} as const;

function saveButton(): HTMLElement {
  return screen.getByTestId("editor-save");
}

function editTitle(title: string): void {
  fireEvent.change(screen.getByLabelText(/title/i), { target: { value: title } });
}

function getEditor() {
  const def = textBlocksClient();
  const Editor = def.resolvers?.["template-resolver:edit"];
  if (!Editor) throw new Error("Editor not registered");
  return Editor;
}

const localeResolver = createStaticLocaleResolver({ locale: "en" });

function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <LocaleProvider
      resolver={localeResolver}
      fallbackBundles={[kumikoDefaultTranslations, defaultTranslations]}
    >
      <PrimitivesProvider value={defaultPrimitives}>{children}</PrimitivesProvider>
    </LocaleProvider>
  );
}

function EnglishWrapper({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en" })}
      fallbackBundles={[kumikoDefaultTranslations, defaultTranslations]}
    >
      <PrimitivesProvider value={defaultPrimitives}>{children}</PrimitivesProvider>
    </LocaleProvider>
  );
}

describe("TextContentEditor — role-based write-access", () => {
  test("TenantAdmin sieht Save-Button + editable inputs", () => {
    // biome-ignore lint/suspicious/noExplicitAny: Bun mock function
    (useShellUser as any).mockReturnValue({ id: "u1", roles: ["TenantAdmin"] });
    const Editor = getEditor();
    render(<Editor target={TARGET} onClose={() => {}} />, { wrapper: Wrapper });

    expect(saveButton().hasAttribute("disabled")).toBe(true);
    editTitle("Impressum neu");
    expect(saveButton().hasAttribute("disabled")).toBe(false);

    expect(screen.queryByText(/Read-only/)).toBeNull();
  });

  test("SystemAdmin sieht Save-Button (alternative write-role)", () => {
    // biome-ignore lint/suspicious/noExplicitAny: Bun mock function
    (useShellUser as any).mockReturnValue({ id: "u1", roles: ["SystemAdmin"] });
    const Editor = getEditor();
    render(<Editor target={TARGET} onClose={() => {}} />, { wrapper: Wrapper });

    editTitle("Impressum neu");
    expect(saveButton().hasAttribute("disabled")).toBe(false);
    expect(screen.queryByText(/Read-only/)).toBeNull();
  });

  test("editor role sees the read-only banner and no save button", () => {
    // biome-ignore lint/suspicious/noExplicitAny: Bun mock function
    (useShellUser as any).mockReturnValue({ id: "u1", roles: ["Editor"] });
    const Editor = getEditor();
    render(<Editor target={TARGET} onClose={() => {}} />, { wrapper: Wrapper });

    expect(screen.getByText(/Read-only/)).toBeTruthy();
    expect(saveButton().hasAttribute("disabled")).toBe(true);
  });

  test("Admin role (publicstatus convention, without TenantAdmin dual tag) sees Read-only banner", () => {
    // biome-ignore lint/suspicious/noExplicitAny: Bun mock function
    (useShellUser as any).mockReturnValue({ id: "u1", roles: ["Admin"] });
    const Editor = getEditor();
    render(<Editor target={TARGET} onClose={() => {}} />, { wrapper: Wrapper });

    expect(screen.getByText(/Read-only/)).toBeTruthy();
    expect(saveButton().hasAttribute("disabled")).toBe(true);
  });

  test("Logged-out (useShellUser=undefined) sieht Read-only-Banner", () => {
    // biome-ignore lint/suspicious/noExplicitAny: Bun mock function
    (useShellUser as any).mockReturnValue(undefined);
    const Editor = getEditor();
    render(<Editor target={TARGET} onClose={() => {}} />, { wrapper: Wrapper });

    expect(screen.getByText(/Read-only/)).toBeTruthy();
    expect(saveButton().hasAttribute("disabled")).toBe(true);
  });
});

describe("TextContentEditor — en locale", () => {
  test("TenantAdmin sees English labels instead of hardcoded German", () => {
    // biome-ignore lint/suspicious/noExplicitAny: Bun mock function
    (useShellUser as any).mockReturnValue({ id: "u1", roles: ["TenantAdmin"] });
    const Editor = getEditor();
    render(<Editor target={TARGET} onClose={() => {}} />, { wrapper: EnglishWrapper });

    expect(saveButton().textContent).toBe("Save");
    expect(screen.getByLabelText(/title/i)).toBeTruthy();
    expect(screen.getByLabelText(/content/i)).toBeTruthy();
  });
});

describe("TextContentEditor — handleSave", () => {
  test("passes the loaded folder through unchanged to the write payload", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: Bun mock function
    (useShellUser as any).mockReturnValue({ id: "u1", roles: ["TenantAdmin"] });
    const write = mock(() => Promise.resolve({ isSuccess: true, data: { isNew: false } }));
    // biome-ignore lint/suspicious/noExplicitAny: Bun mock function
    (useDispatcher as any).mockReturnValue({ write, query: mock() });

    const Editor = getEditor();
    render(<Editor target={TARGET} onClose={() => {}} />, { wrapper: Wrapper });

    await act(async () => {
      editTitle("Impressum neu");
      fireEvent.click(saveButton());
      await Promise.resolve();
    });

    expect(write).toHaveBeenCalledTimes(1);
    const [, payload] = write.mock.calls[0] as unknown as [unknown, { folder: string | null }];
    expect(payload.folder).toBe("legal");
  });

  // TARGET has no collectionId, so the collection's declared contentFormat is
  // always undefined here — the write payload must fall back to the loaded
  // entry's own contentFormat ("plain") instead of silently defaulting to
  // "markdown" via the write schema's contentFormatSchema.default("markdown").
  test("sends the loaded contentFormat unchanged instead of defaulting it to markdown", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: Bun mock function
    (useShellUser as any).mockReturnValue({ id: "u1", roles: ["TenantAdmin"] });
    const write = mock(() => Promise.resolve({ isSuccess: true, data: { isNew: false } }));
    // biome-ignore lint/suspicious/noExplicitAny: Bun mock function
    (useDispatcher as any).mockReturnValue({ write, query: mock() });

    const Editor = getEditor();
    render(<Editor target={TARGET} onClose={() => {}} />, { wrapper: Wrapper });

    await act(async () => {
      editTitle("Impressum neu");
      fireEvent.click(saveButton());
      await Promise.resolve();
    });

    expect(write).toHaveBeenCalledTimes(1);
    const [, payload] = write.mock.calls[0] as unknown as [unknown, { contentFormat?: string }];
    expect(payload.contentFormat).toBe("plain");
  });
});
