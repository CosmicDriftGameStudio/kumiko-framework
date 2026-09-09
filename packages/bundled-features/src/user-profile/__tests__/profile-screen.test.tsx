// Render test against the real i18n bundles (catches missing keys — the
// sections must never show raw "profile.*" keys). Provider wrapper mirrors
// renderer-web/test-utils, duplicated locally because the renderer-web →
// bundled-features dependency direction is forbidden.
//
// fw#2312: the `profile` screen is no longer a React component (ProfileScreen)
// — it's a declarative projectionDetail (feature.ts, boot-tested in
// profile-screen.boot.test.ts). Only change-email/change-password stay
// EditExtensionSection components (re-auth flows a declarative action can't
// express); the danger zone is fields + actions.

import { describe, expect, spyOn, test } from "bun:test";
import { createStore, type Dispatcher, type DispatcherStatus } from "@cosmicdrift/kumiko-headless";
import {
  createStaticLocaleResolver,
  DispatcherProvider,
  kumikoDefaultTranslations,
  type LiveEventSubscriber,
  LiveEventsProvider,
  LocaleProvider,
  PrimitivesProvider,
  TokensProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives, defaultTokens } from "@cosmicdrift/kumiko-renderer-web";
import { fireEvent, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { defaultTranslations } from "../i18n";
import { ChangeEmailSection, ChangePasswordSection } from "../web/profile-screen";

const stubLiveEvents: LiveEventSubscriber = () => () => {};
const stubTokens = {
  tokens: defaultTokens,
  mode: "light" as const,
  setMode: () => {},
  toggleMode: () => {},
};
const stubResolver = createStaticLocaleResolver();

function makeDispatcher(writes: Array<{ type: string; payload: unknown }>): Dispatcher {
  const statusStore = createStore<DispatcherStatus>("online");
  const write = (async (type: string, payload: unknown) => {
    writes.push({ type, payload });
    return { isSuccess: true, data: {} };
  }) as unknown as Dispatcher["write"];
  return {
    write,
    query: (async () => ({ isSuccess: true, data: null })) as unknown as Dispatcher["query"],
    batch: (async () => ({ isSuccess: true, results: [] })) as unknown as Dispatcher["batch"],
    statusStore,
    async *stream() {},
    pendingWrites: () => [],
    pendingFiles: () => [],
  } as unknown as Dispatcher; // @cast-boundary test-stub
}

function withProviders(writes: Array<{ type: string; payload: unknown }>) {
  return ({ children }: { readonly children: ReactNode }): ReactNode => (
    <TokensProvider value={stubTokens}>
      <LocaleProvider
        resolver={stubResolver}
        fallbackBundles={[defaultTranslations, kumikoDefaultTranslations]}
      >
        <PrimitivesProvider value={defaultPrimitives}>
          <LiveEventsProvider value={stubLiveEvents}>
            <DispatcherProvider dispatcher={makeDispatcher(writes)}>{children}</DispatcherProvider>
          </LiveEventsProvider>
        </PrimitivesProvider>
      </LocaleProvider>
    </TokensProvider>
  );
}

function renderChangeEmailSection(email: string) {
  const writes: Array<{ type: string; payload: unknown }> = [];
  const patchCalls: Array<Readonly<Record<string, unknown>>> = [];
  const patch = (partial: Readonly<Record<string, unknown>>): void => {
    patchCalls.push(partial);
  };
  // ChangeEmailSection renders no Section/title of its own in production
  // (the renderer's ExtensionSectionMount supplies that) — a plain testId
  // wrapper here is test-only scaffolding to detect "mounted".
  const view = render(
    <div data-testid="change-email-root">
      <ChangeEmailSection entityName="user" entityId={null} values={{ email }} patch={patch} />
    </div>,
    { wrapper: withProviders(writes) },
  );
  return { view, writes, patchCalls };
}

function renderChangePasswordSection() {
  const writes: Array<{ type: string; payload: unknown }> = [];
  const view = render(
    <div data-testid="change-password-root">
      <ChangePasswordSection />
    </div>,
    { wrapper: withProviders(writes) },
  );
  return { view, writes };
}

async function waitForMount(view: ReturnType<typeof render>, testId: string): Promise<void> {
  await waitFor(() => {
    if (view.queryByTestId(testId) === null) throw new Error("not mounted yet");
  });
}

// Reproduces the real host: RenderEdit renders exactly one <form
// testId="render-edit-form"> around every singleton projectionDetail screen
// (render-edit.tsx), and both sections mount as children of that form via
// ExtensionSectionMount. A section that renders its own <form> nests invalid
// DOM inside it — the security bug this guards against: the submit button
// falls back to a native GET navigation, putting the password(s) in the URL
// query instead of dispatching a write.
function renderInsideHostForm(node: ReactNode) {
  const writes: Array<{ type: string; payload: unknown }> = [];
  const view = render(<form data-testid="render-edit-form">{node}</form>, {
    wrapper: withProviders(writes),
  });
  return { view, writes };
}

describe("ChangeEmailSection", () => {
  test("renders no <form> of its own (would nest inside the host RenderEdit <form>), shows the current email, no raw i18n keys", async () => {
    const { view } = renderChangeEmailSection("marc@example.com");
    await waitForMount(view, "change-email-root");
    expect(view.container.querySelector("form")).toBeNull();
    expect(view.getByTestId("profile-email-current").textContent).toContain("marc@example.com");
    expect(view.container.textContent).not.toContain("profile.");
  });

  // Security regression guard: mounted inside the real host <form> (as
  // RenderEdit does in production), a click on the submit button must still
  // reach the write dispatcher — not fall back to the host form's native
  // GET submission, which would put currentPassword/newEmail in the URL.
  test("mounted inside the host RenderEdit <form>, a click on the submit button dispatches change-email (no nested <form>, no native submit fallback)", async () => {
    const { view, writes } = renderInsideHostForm(
      <ChangeEmailSection
        entityName="user"
        entityId={null}
        values={{ email: "old@example.com" }}
        patch={() => {}}
      />,
    );
    await waitForMount(view, "profile-email");
    expect(view.container.querySelectorAll("form")).toHaveLength(1);

    const emailInput = view.container.querySelector<HTMLInputElement>("#profile-new-email");
    const pwInput = view.container.querySelector<HTMLInputElement>("#profile-email-password");
    if (!emailInput || !pwInput) throw new Error("email form inputs not found");
    fireEvent.change(emailInput, { target: { value: "new@example.com" } });
    fireEvent.change(pwInput, { target: { value: "current-pw" } });
    fireEvent.click(view.getByTestId("profile-email-submit"));

    await waitFor(() => {
      if (writes.length === 0) throw new Error("no write dispatched yet");
    });
    expect(writes[0]).toEqual({
      type: "user-profile:write:change-email",
      payload: { currentPassword: "current-pw", newEmail: "new@example.com" },
    });
  });

  test("submits change-email with currentPassword + newEmail, patches the host's email on success", async () => {
    const { view, writes, patchCalls } = renderChangeEmailSection("old@example.com");
    await waitForMount(view, "profile-email");

    const emailInput = view.container.querySelector<HTMLInputElement>("#profile-new-email");
    const pwInput = view.container.querySelector<HTMLInputElement>("#profile-email-password");
    if (!emailInput || !pwInput) throw new Error("email form inputs not found");
    fireEvent.change(emailInput, { target: { value: "new@example.com" } });
    fireEvent.change(pwInput, { target: { value: "current-pw" } });
    fireEvent.click(view.getByTestId("profile-email-submit"));

    await waitFor(() => {
      if (writes.length === 0) throw new Error("no write dispatched yet");
    });
    expect(writes[0]).toEqual({
      type: "user-profile:write:change-email",
      payload: { currentPassword: "current-pw", newEmail: "new@example.com" },
    });
    await waitFor(() => {
      if (patchCalls.length === 0) throw new Error("patch not called yet");
    });
    expect(patchCalls[0]).toEqual({ email: "new@example.com" });
  });

  // #322/3: after a successful email change, the section triggers the
  // verification-mail send. A failure there must not reverse the success —
  // but it's no longer silently swallowed (otherwise the user waits for a
  // mail that never arrives) and the success message no longer promises a
  // send.
  test("verification-send failure is surfaced (not swallowed), change still succeeds", async () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    const fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in test"));
    try {
      const { view } = renderChangeEmailSection("old@example.com");
      await waitForMount(view, "profile-email");

      const emailInput = view.container.querySelector<HTMLInputElement>("#profile-new-email");
      const pwInput = view.container.querySelector<HTMLInputElement>("#profile-email-password");
      if (!emailInput || !pwInput) throw new Error("email form inputs not found");
      fireEvent.change(emailInput, { target: { value: "new@example.com" } });
      fireEvent.change(pwInput, { target: { value: "current-pw" } });
      fireEvent.click(view.getByTestId("profile-email-submit"));

      // De-swallow: the failed verification-mail send is logged.
      await waitFor(() => {
        const warned = warnSpy.mock.calls.some((c) => String(c[0]).includes("[user-profile]"));
        if (!warned) throw new Error("verification-send failure not surfaced");
      });
      // The change still succeeds: the input field is cleared.
      await waitFor(() => {
        if (emailInput.value !== "") throw new Error("email input not cleared after success");
      });
      // The success message no longer promises a link send.
      expect(view.container.textContent).not.toContain("verification link");
      expect(view.container.textContent).not.toContain("Bestätigungslink");
    } finally {
      warnSpy.mockRestore();
      fetchSpy.mockRestore();
    }
  });

  // #472/1: the server answers the verification-mail send with ok:false
  // (e.g. 4xx) WITHOUT throwing. That's a different branch than the catch
  // above — it must be logged on its own, and the change still succeeds.
  test("verification-send rejected by server (ok:false) is surfaced", async () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 400 }),
    );
    try {
      const { view } = renderChangeEmailSection("old@example.com");
      await waitForMount(view, "profile-email");

      const emailInput = view.container.querySelector<HTMLInputElement>("#profile-new-email");
      const pwInput = view.container.querySelector<HTMLInputElement>("#profile-email-password");
      if (!emailInput || !pwInput) throw new Error("email form inputs not found");
      fireEvent.change(emailInput, { target: { value: "new@example.com" } });
      fireEvent.change(pwInput, { target: { value: "current-pw" } });
      fireEvent.click(view.getByTestId("profile-email-submit"));

      // The ok:false branch logs ITS OWN message ("could not be sent"),
      // not the catch branch's ("send threw").
      await waitFor(() => {
        const hit = warnSpy.mock.calls.some((c) => String(c[0]).includes("could not be sent"));
        if (!hit) throw new Error("ok:false verification failure not surfaced");
      });
      expect(warnSpy.mock.calls.some((c) => String(c[0]).includes("send threw"))).toBe(false);
      await waitFor(() => {
        if (emailInput.value !== "") throw new Error("email input not cleared after success");
      });
    } finally {
      warnSpy.mockRestore();
      fetchSpy.mockRestore();
    }
  });
});

describe("ChangePasswordSection", () => {
  test("renders no <form> of its own (would nest inside the host RenderEdit <form>), no raw i18n keys", async () => {
    const { view } = renderChangePasswordSection();
    await waitForMount(view, "change-password-root");
    expect(view.container.querySelector("form")).toBeNull();
    expect(view.container.textContent).not.toContain("profile.");
  });

  // Security regression guard: mounted inside the real host <form> (as
  // RenderEdit does in production), a click on the submit button must still
  // reach the write dispatcher — not fall back to the host form's native
  // GET submission, which would put old+new passwords in the URL.
  test("mounted inside the host RenderEdit <form>, a click on the submit button dispatches change-password (no nested <form>, no native submit fallback)", async () => {
    const { view, writes } = renderInsideHostForm(<ChangePasswordSection />);
    await waitForMount(view, "profile-password");
    expect(view.container.querySelectorAll("form")).toHaveLength(1);

    const oldPw = view.container.querySelector<HTMLInputElement>("#profile-old-password");
    const newPw = view.container.querySelector<HTMLInputElement>("#profile-new-password");
    const confirmPw = view.container.querySelector<HTMLInputElement>("#profile-confirm-password");
    if (!oldPw || !newPw || !confirmPw) throw new Error("password form inputs not found");
    fireEvent.change(oldPw, { target: { value: "current-pw" } });
    fireEvent.change(newPw, { target: { value: "new-pw-1" } });
    fireEvent.change(confirmPw, { target: { value: "new-pw-1" } });
    fireEvent.click(view.getByTestId("profile-password-submit"));

    await waitFor(() => {
      if (writes.length === 0) throw new Error("no write dispatched yet");
    });
    expect(writes[0]).toEqual({
      type: "auth-email-password:write:change-password",
      payload: { oldPassword: "current-pw", newPassword: "new-pw-1" },
    });
  });

  test("mismatched confirm password blocks the submit (no write dispatched)", async () => {
    const { view, writes } = renderChangePasswordSection();
    await waitForMount(view, "profile-password");

    const oldPw = view.container.querySelector<HTMLInputElement>("#profile-old-password");
    const newPw = view.container.querySelector<HTMLInputElement>("#profile-new-password");
    const confirmPw = view.container.querySelector<HTMLInputElement>("#profile-confirm-password");
    if (!oldPw || !newPw || !confirmPw) throw new Error("password form inputs not found");
    fireEvent.change(oldPw, { target: { value: "current-pw" } });
    fireEvent.change(newPw, { target: { value: "new-pw-1" } });
    fireEvent.change(confirmPw, { target: { value: "new-pw-2" } });
    fireEvent.click(view.getByTestId("profile-password-submit"));

    await waitFor(() => {
      if (!view.container.textContent?.includes("do not match")) {
        throw new Error("mismatch error not shown yet");
      }
    });
    expect(writes).toHaveLength(0);
  });

  test("matching passwords dispatch change-password with old/new", async () => {
    const { view, writes } = renderChangePasswordSection();
    await waitForMount(view, "profile-password");

    const oldPw = view.container.querySelector<HTMLInputElement>("#profile-old-password");
    const newPw = view.container.querySelector<HTMLInputElement>("#profile-new-password");
    const confirmPw = view.container.querySelector<HTMLInputElement>("#profile-confirm-password");
    if (!oldPw || !newPw || !confirmPw) throw new Error("password form inputs not found");
    fireEvent.change(oldPw, { target: { value: "current-pw" } });
    fireEvent.change(newPw, { target: { value: "new-pw-1" } });
    fireEvent.change(confirmPw, { target: { value: "new-pw-1" } });
    fireEvent.click(view.getByTestId("profile-password-submit"));

    await waitFor(() => {
      if (writes.length === 0) throw new Error("no write dispatched yet");
    });
    expect(writes[0]).toEqual({
      type: "auth-email-password:write:change-password",
      payload: { oldPassword: "current-pw", newPassword: "new-pw-1" },
    });
  });
});
