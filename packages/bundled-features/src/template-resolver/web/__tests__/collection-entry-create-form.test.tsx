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
        {
          id: "signatures",
          kind: "snippet",
          ownership: "user",
          contentFormat: "plain",
          access: { roles: ["Agent"] },
          variableSchema: {},
          nav: { label: "mail:nav.signatures" },
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

function renderForm(
  write: ReturnType<typeof mock>,
  opts: { readonly tenantId?: string; readonly collectionId?: string } = {},
): void {
  // biome-ignore lint/suspicious/noExplicitAny: Bun mock function
  (useShellUser as any).mockReturnValue({ id: "u1", roles: ["Agent"] });
  // biome-ignore lint/suspicious/noExplicitAny: Bun mock function
  (useDispatcher as any).mockReturnValue({ write, query: mock() });
  const Create = textBlocksClient(
    opts.tenantId !== undefined ? { tenantId: opts.tenantId } : undefined,
  ).resolvers?.["template-resolver:create"];
  if (!Create) throw new Error("create resolver not registered");
  const target = { ...TARGET, args: { collectionId: opts.collectionId ?? "prompts" } };
  render(<Create target={target} onClose={() => {}} />, { wrapper: Wrapper });
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

  describe("tenant of the new entry", () => {
    const created = () =>
      Promise.resolve({ isSuccess: true, data: { slug: "triage", locale: "en", isNew: true } });
    const denied = () =>
      Promise.resolve({
        isSuccess: false,
        error: {
          code: "forbidden",
          httpStatus: 403,
          i18nKey: "errors.forbidden",
          message: "denied",
          details: { reason: "tenant_override_requires_system_admin" },
        },
      });

    async function submit(): Promise<void> {
      fill(/slug/i, "triage");
      fill(/title/i, "Triage");
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /create/i }));
        await Promise.resolve();
        await Promise.resolve();
      });
    }

    const payloadOf = (write: ReturnType<typeof mock>, call: number) =>
      (write.mock.calls[call] as unknown as [string, Record<string, unknown>])[1];

    test("a shared collection is written to the plugin tenant and its editor keeps it", async () => {
      dispatchTarget.mockClear();
      const write = mock(created);
      renderForm(write, { tenantId: "system" });
      await submit();
      expect(payloadOf(write, 0)["tenantIdOverride"]).toBe("system");
      expect(dispatchTarget).toHaveBeenCalledWith({
        featureId: "template-resolver",
        action: "edit",
        args: { slug: "triage", locale: "en", collectionId: "prompts", tenantIdOverride: "system" },
      });
    });

    test("a per-user collection is written to the session tenant", async () => {
      dispatchTarget.mockClear();
      const write = mock(created);
      renderForm(write, { tenantId: "system", collectionId: "signatures" });
      await submit();
      expect(payloadOf(write, 0)).not.toHaveProperty("tenantIdOverride");
      expect(dispatchTarget).toHaveBeenCalledWith({
        featureId: "template-resolver",
        action: "edit",
        args: { slug: "triage", locale: "en", collectionId: "signatures" },
      });
    });

    test("a denied override retries once on the session tenant", async () => {
      dispatchTarget.mockClear();
      const write = mock().mockImplementationOnce(denied).mockImplementationOnce(created);
      renderForm(write, { tenantId: "system" });
      await submit();
      expect(write).toHaveBeenCalledTimes(2);
      expect(payloadOf(write, 0)["tenantIdOverride"]).toBe("system");
      expect(payloadOf(write, 1)).not.toHaveProperty("tenantIdOverride");
      expect(dispatchTarget).toHaveBeenCalledWith({
        featureId: "template-resolver",
        action: "edit",
        args: { slug: "triage", locale: "en", collectionId: "prompts" },
      });
    });
  });
});
