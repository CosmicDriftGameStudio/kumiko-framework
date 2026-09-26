import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { defaultPrimitives } from "../index";

const { StickyActionBar, CopyButton, ShareButton, PromoPanel } = defaultPrimitives;
if (
  StickyActionBar === undefined ||
  CopyButton === undefined ||
  ShareButton === undefined ||
  PromoPanel === undefined
) {
  throw new Error("default registry must ship the public-page primitives");
}

describe("StickyActionBar", () => {
  test("back control is an icon button with an accessible name and fires onBack", () => {
    const onBack = mock(() => {});
    render(
      <StickyActionBar back={{ onBack, label: "Zurück" }} testId="bar">
        <button type="submit">Weiter</button>
      </StickyActionBar>,
    );
    const back = screen.getByRole("button", { name: "Zurück" });
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Weiter" })).toBeTruthy();
  });

  test("pins to the bottom on narrow viewports with the safe-area inset as bottom padding", () => {
    render(
      <StickyActionBar testId="bar">
        <button type="button">Weiter</button>
      </StickyActionBar>,
    );
    const bar = screen.getByTestId("bar");
    expect(bar.className).toContain("max-sm:fixed");
    expect(bar.className).toContain("max-sm:bottom-0");
    expect(bar.className).toContain("env(safe-area-inset-bottom)");
    expect(screen.queryByTestId("bar-back")).toBeNull();
    // The spacer in front keeps the last content row scrollable above the bar.
    const spacer = bar.previousElementSibling as HTMLElement;
    expect(spacer.getAttribute("aria-hidden")).toBe("true");
    expect(spacer.className).toContain("env(safe-area-inset-bottom)");
  });
});

describe("CopyButton", () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  afterEach(() => {
    if (originalClipboard !== undefined) {
      Object.defineProperty(navigator, "clipboard", originalClipboard);
    }
  });

  function stubClipboard(writeText: (text: string) => Promise<void>): void {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  }

  test("writes the text to the clipboard and flips to the copied label", async () => {
    const written: string[] = [];
    stubClipboard(async (text) => {
      written.push(text);
    });
    render(<CopyButton text={"Zeile 1\nZeile 2"} label="Text kopieren" copiedLabel="Kopiert" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Text kopieren" }));
    });

    expect(written).toEqual(["Zeile 1\nZeile 2"]);
    expect(screen.getByRole("button", { name: "Kopiert" })).toBeTruthy();
  });

  test("a rejected clipboard write keeps the original label", async () => {
    stubClipboard(async () => {
      throw new Error("NotAllowedError");
    });
    render(<CopyButton text="x" label="Text kopieren" copiedLabel="Kopiert" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Text kopieren" }));
    });

    expect(screen.queryByRole("button", { name: "Kopiert" })).toBeNull();
    expect(screen.getByRole("button", { name: "Text kopieren" })).toBeTruthy();
  });
});

describe("ShareButton", () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, "share");
  });

  test("whatsapp target is a new-tab wa.me link carrying the text and recipient", () => {
    render(
      <ShareButton
        target="whatsapp"
        text="Frisch reingekommen"
        phone="+49 171 2345678"
        label="In WhatsApp teilen"
      />,
    );
    const link = screen.getByRole("link", { name: "In WhatsApp teilen" });
    const href = new URL(link.getAttribute("href") ?? "");
    expect(href.origin + href.pathname).toBe("https://wa.me/491712345678");
    expect(href.searchParams.get("text")).toBe("Frisch reingekommen");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  test("system target renders nothing where the browser has no share sheet", () => {
    Reflect.deleteProperty(navigator, "share");
    render(<ShareButton target="system" text="x" label="Teilen" testId="share" />);
    expect(screen.queryByTestId("share")).toBeNull();
  });

  test("system target hands text, title and url to the share sheet", async () => {
    const share = mock(async (_data: ShareData) => {});
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    render(
      <ShareButton
        target="system"
        text="Octavia"
        title="Škoda"
        url="https://example.test/v/1"
        label="Teilen"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Teilen" }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(share.mock.calls[0]?.[0]).toEqual({
      text: "Octavia",
      title: "Škoda",
      url: "https://example.test/v/1",
    });
  });
});

describe("PromoPanel", () => {
  test("renders eyebrow, headline, benefits and a link call to action on the promo surface", () => {
    render(
      <PromoPanel
        eyebrow="Das war ein Kanal"
        title="Mit Konto erreicht dieser Octavia alle Kanäle."
        action={{ label: "Kostenloses Konto sichern", href: "/signup", testId: "promo-cta" }}
        testId="promo"
      >
        <p>Kampagne über bis zu 60 Tage.</p>
      </PromoPanel>,
    );
    const panel = screen.getByTestId("promo");
    expect(panel.className).toContain("bg-promo");
    expect(panel.className).not.toContain("bg-muted");
    expect(
      screen.getByRole("heading", { name: "Mit Konto erreicht dieser Octavia alle Kanäle." }),
    ).toBeTruthy();
    expect(panel.textContent).toContain("Das war ein Kanal");
    expect(panel.textContent).toContain("Kampagne über bis zu 60 Tage.");
    expect(screen.getByTestId("promo-cta").getAttribute("href")).toBe("/signup");
  });

  test("a click action renders a button instead of a link", () => {
    const onClick = mock(() => {});
    render(<PromoPanel title="Angebot" action={{ label: "Los", onClick }} />);
    fireEvent.click(screen.getByRole("button", { name: "Los" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
