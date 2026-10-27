import { describe, expect, mock, test } from "bun:test";
import { useShellUser } from "@cosmicdrift/kumiko-bundled-features/auth-email-password/web";
import {
  createStaticLocaleResolver,
  LocaleProvider,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer/web";
import { mockModuleForFile } from "@cosmicdrift/kumiko-testing/helpers/mock-module";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { textBlocksClient } from "../client-plugin.tsx";
import { defaultTranslations } from "../i18n.ts";

const dispatchTarget = mock();

mockModuleForFile(
  "@cosmicdrift/kumiko-bundled-features/auth-email-password/web",
  await import("@cosmicdrift/kumiko-bundled-features/auth-email-password/web"),
  { useShellUser: mock() },
);

mockModuleForFile(
  "@cosmicdrift/kumiko-renderer/web",
  await import("@cosmicdrift/kumiko-renderer/web"),
  { useDispatchTarget: () => dispatchTarget },
);

mockModuleForFile("@cosmicdrift/kumiko-renderer", await import("@cosmicdrift/kumiko-renderer"), {
  useDispatcher: mock(),
  useAppFeatures: mock(() => [
    {
      featureName: "mail",
      contentCollections: [
        {
          id: "prompts",
          kind: "ai-prompt",
          contentFormat: "plain",
          access: { roles: ["Agent"] },
          variableSchema: {},
          nav: { label: "mail:nav.prompts" },
        },
      ],
    },
  ]),
});

const { useDispatcher } = await import("@cosmicdrift/kumiko-renderer");

const TARGET = {
  featureId: "template-resolver",
  action: "create",
  args: { collectionId: "prompts" },
} as const;

function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en" })}
      fallbackBundles={[defaultTranslations]}
    >
      <PrimitivesProvider value={defaultPrimitives}>{children}</PrimitivesProvider>
    </LocaleProvider>
  );
}

function renderForm(write: ReturnType<typeof mock>): void {
  // biome-ignore lint/suspicious/noExplicitAny: Bun mock function
  (useShellUser as any).mockReturnValue({ id: "u1", roles: ["Agent"] });
  // biome-ignore lint/suspicious/noExplicitAny: Bun mock function
  (useDispatcher as any).mockReturnValue({ write, query: mock() });
  const Create = textBlocksClient().resolvers?.["template-resolver:create"];
  if (!Create) throw new Error("create resolver not registered");
  render(<Create target={TARGET} onClose={() => {}} />, { wrapper: Wrapper });
}

function fill(label: RegExp, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("collection entry create form", () => {
  test("the resolver is registered", () => {
    expect(textBlocksClient().resolvers?.["template-resolver:create"]).toBeDefined();
  });

  test("an invalid slug blocks submit and shows the slug message", () => {
    renderForm(mock());
    fill(/slug/i, "Not Valid!");
    fill(/title/i, "Titel");
    expect(screen.getAllByText(/lowercase letters, digits and dashes/).length).toBeGreaterThan(0);
    expect((screen.getByRole("button", { name: /create/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  test("a valid entry is written create-only and opens the edit target", async () => {
    dispatchTarget.mockClear();
    const write = mock(() =>
      Promise.resolve({ isSuccess: true, data: { slug: "triage", locale: "en", isNew: true } }),
    );
    renderForm(write);
    fill(/slug/i, "triage");
    fill(/title/i, "Triage");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /create/i }));
      await Promise.resolve();
    });
    expect(write).toHaveBeenCalledTimes(1);
    const [handler, payload] = write.mock.calls[0] as unknown as [
      string,
      { slug: string; createOnly: boolean },
    ];
    expect(handler).toContain("prompts");
    expect(payload.slug).toBe("triage");
    expect(payload.createOnly).toBe(true);
    expect(dispatchTarget).toHaveBeenCalledWith({
      featureId: "template-resolver",
      action: "edit",
      args: { slug: "triage", locale: "en", collectionId: "prompts" },
    });
  });

  test("a taken slug shows an error banner and does not navigate", async () => {
    dispatchTarget.mockClear();
    const write = mock(() =>
      Promise.resolve({
        isSuccess: false,
        error: {
          code: "validation_error",
          details: {
            fields: [
              {
                path: "slug",
                code: "slug_exists",
                i18nKey: "templateResolver.errors.collection.slugExists",
                params: { detail: "triage" },
              },
            ],
          },
        },
      }),
    );
    renderForm(write);
    fill(/slug/i, "triage");
    fill(/title/i, "Triage");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /create/i }));
      await Promise.resolve();
    });
    expect(screen.getByText(/triage/i, { selector: "[role=alert], [role=alert] *" })).toBeTruthy();
    expect(dispatchTarget).not.toHaveBeenCalled();
  });
});
