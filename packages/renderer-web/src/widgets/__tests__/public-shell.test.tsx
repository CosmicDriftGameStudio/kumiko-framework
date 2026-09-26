import { describe, expect, test } from "bun:test";
import { render, screen, within } from "../../__tests__/test-utils";
import { PublicShell } from "../public-shell";

const brand = <span>OFFLOT</span>;

describe("PublicShell", () => {
  test("every variant renders the same header and footer landmarks around the content", () => {
    for (const variant of ["marketing", "focus", "card"] as const) {
      const { unmount } = render(
        <PublicShell
          variant={variant}
          brand={brand}
          headerActions={<button type="button">Anmelden</button>}
          footer={<a href="/impressum">Impressum</a>}
        >
          <p>Inhalt</p>
        </PublicShell>,
      );
      const header = screen.getByRole("banner");
      expect(within(header).getByText("OFFLOT")).toBeTruthy();
      expect(within(header).getByRole("button", { name: "Anmelden" })).toBeTruthy();
      expect(within(screen.getByRole("main")).getByText("Inhalt")).toBeTruthy();
      expect(within(screen.getByRole("contentinfo")).getByText("Impressum")).toBeTruthy();
      unmount();
    }
  });

  test("marketing shows the notice bar above the header", () => {
    render(
      <PublicShell variant="marketing" brand={brand} notice="Kostenlos testen">
        <p>Inhalt</p>
      </PublicShell>,
    );
    const notice = screen.getByTestId("public-shell-notice");
    expect(notice.textContent).toBe("Kostenlos testen");
    expect(notice.compareDocumentPosition(screen.getByRole("banner"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  test("focus puts the progress slot inside the header and keeps the task column narrow", () => {
    render(
      <PublicShell variant="focus" brand={brand} progress={<ol aria-label="Fortschritt" />}>
        <p>Schritt</p>
      </PublicShell>,
    );
    expect(
      within(screen.getByRole("banner")).getByRole("list", { name: "Fortschritt" }),
    ).toBeTruthy();
    expect(screen.getByRole("main").className).toContain("max-w-3xl");
  });

  test("card wraps the content in a single centered card", () => {
    render(
      <PublicShell variant="card" brand={brand}>
        <form aria-label="Anmelden" />
      </PublicShell>,
    );
    const card = screen.getByTestId("public-shell-card");
    expect(within(card).getByRole("form", { name: "Anmelden" })).toBeTruthy();
    expect(screen.getByRole("main").className).toContain("justify-center");
  });

  test("footer is omitted when no footer is given", () => {
    render(
      <PublicShell variant="marketing" brand={brand}>
        <p>Inhalt</p>
      </PublicShell>,
    );
    expect(screen.queryByRole("contentinfo")).toBeNull();
    expect(screen.queryByTestId("public-shell-notice")).toBeNull();
  });
});
