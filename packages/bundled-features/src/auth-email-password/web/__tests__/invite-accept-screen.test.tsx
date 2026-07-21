// InviteAcceptScreen is a public route — anon invite-links are the
// documented use case (no <SessionProvider> ancestor). Regression 632/1:
// useSession() throws without a provider, so any consumer mounting this
// screen on a public route outside SessionAuthGate crashed at runtime.

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createStaticLocaleResolver,
  LocaleProvider,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer-web";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { defaultTranslations } from "../../i18n";
import { InviteAcceptScreen } from "../invite-accept-screen";
import { makeSessionApi, renderWithProviders } from "./test-utils";

const resolver = createStaticLocaleResolver({ locale: "de" });

function renderWithoutSessionProvider(token: string) {
  return render(
    <PrimitivesProvider value={defaultPrimitives}>
      <LocaleProvider resolver={resolver} fallbackBundles={[defaultTranslations]}>
        <InviteAcceptScreen token={token} />
      </LocaleProvider>
    </PrimitivesProvider>,
  );
}

beforeEach(() => {
  globalThis.fetch = mock(
    async () => new Response(JSON.stringify({ tenantId: "tenant-new" }), { status: 200 }),
  ) as unknown as typeof fetch;
});
afterEach(() => {
  Object.defineProperty(window, "location", {
    writable: true,
    configurable: true,
    value: { ...window.location, assign: () => {} },
  });
});

describe("InviteAcceptScreen — no <SessionProvider> ancestor (632/1)", () => {
  test("renders the anonymous accept-form instead of throwing", () => {
    renderWithoutSessionProvider("tok-123");
    expect(screen.getByText("Einladung annehmen")).toBeTruthy();
    expect(screen.getByLabelText(/^Passwort/)).toBeTruthy();
    // Anon default mode is "anon-existing" — email field is shown too.
    expect(screen.getByLabelText(/^E-Mail/)).toBeTruthy();
  });

  test("missing token still renders (no session access needed for that branch)", () => {
    renderWithoutSessionProvider("");
    expect(
      screen.getByText("Der Einladungs-Link enthält keinen Token oder ist ungültig."),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Zum Login" }).getAttribute("href")).toBe("/login");
  });
});

describe("InviteAcceptScreen — logged-in branch", () => {
  test("authenticated session shows 1-click accept form", () => {
    renderWithProviders(<InviteAcceptScreen token="tok-123" />, {
      session: makeSessionApi({ status: "authenticated" }),
    });
    expect(screen.getByText(/Du bist eingeloggt/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Annehmen" })).toBeTruthy();
    expect(screen.queryByLabelText(/^E-Mail/)).toBeNull();
  });

  test("accept logged-in success redirects via loggedInHref function", async () => {
    const assign = mock<(url: string) => void>();
    Object.defineProperty(window, "location", {
      writable: true,
      configurable: true,
      value: { ...window.location, assign },
    });
    renderWithProviders(
      <InviteAcceptScreen token="tok-123" loggedInHref={({ tenantId }) => `/${tenantId}/home`} />,
      { session: makeSessionApi({ status: "authenticated" }) },
    );
    fireEvent.click(screen.getByRole("button", { name: "Annehmen" }));
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith("/tenant-new/home");
    });
  });

  test("accept logged-in failure shows invalidInviteToken banner", async () => {
    globalThis.fetch = mock(async () => new Response(null, { status: 422 })) as unknown as typeof fetch;
    renderWithProviders(<InviteAcceptScreen token="bad" />, {
      session: makeSessionApi({ status: "authenticated" }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Annehmen" }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("auth.errors.invalidInviteToken");
    });
  });

  test("use other account switches to anon-existing form", () => {
    renderWithProviders(<InviteAcceptScreen token="tok-123" />, {
      session: makeSessionApi({ status: "authenticated" }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Mit anderem Account anmelden" }));
    expect(screen.getByLabelText(/^E-Mail/)).toBeTruthy();
  });
});

describe("InviteAcceptScreen — anonymous branches", () => {
  test("anon-existing submit posts invite-accept-with-login", async () => {
    const fetchMock = mock(
      async () => new Response(JSON.stringify({ tenantId: "t1" }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    renderWithoutSessionProvider("tok-123");
    fireEvent.change(screen.getByLabelText(/^E-Mail/), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText(/^Passwort/), { target: { value: "secret123" } });
    fireEvent.click(screen.getByRole("button", { name: "Annehmen + Anmelden" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/invite-accept-with-login",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ token: "tok-123", email: "a@example.com", password: "secret123" }),
        }),
      );
    });
  });

  test("toggle to anon-new hides email and posts invite-signup-complete", async () => {
    const fetchMock = mock(
      async () => new Response(JSON.stringify({ tenantId: "t1" }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    renderWithoutSessionProvider("tok-123");
    fireEvent.click(screen.getByRole("button", { name: "Ich habe noch keinen Account" }));
    expect(screen.queryByLabelText(/^E-Mail/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/^Passwort/), { target: { value: "newpass123" } });
    fireEvent.click(screen.getByRole("button", { name: "Annehmen + Anmelden" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/invite-signup-complete",
        expect.objectContaining({
          body: JSON.stringify({ token: "tok-123", password: "newpass123" }),
        }),
      );
    });
  });

  test("anon failure shows invalidInviteToken banner", async () => {
    globalThis.fetch = mock(async () => new Response(null, { status: 422 })) as unknown as typeof fetch;
    renderWithoutSessionProvider("tok-123");
    fireEvent.change(screen.getByLabelText(/^E-Mail/), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText(/^Passwort/), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Annehmen + Anmelden" }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("auth.errors.invalidInviteToken");
    });
  });
});

