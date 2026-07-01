// InviteAcceptScreen is a public route — anon invite-links are the
// documented use case (no <SessionProvider> ancestor). Regression 632/1:
// useSession() throws without a provider, so any consumer mounting this
// screen on a public route outside SessionAuthGate crashed at runtime.

import { describe, expect, test } from "bun:test";
import {
  createStaticLocaleResolver,
  LocaleProvider,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer-web";
import { render, screen } from "@testing-library/react";
import { defaultTranslations } from "../../i18n";
import { InviteAcceptScreen } from "../invite-accept-screen";

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
  });
});
