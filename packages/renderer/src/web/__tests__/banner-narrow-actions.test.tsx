// Phone width: an inline banner keeps its text on the full row and wraps the actions below it.

import { describe, expect, test } from "bun:test";
import { DefaultBanner } from "../primitives/banner.tsx";
import { render, screen, within } from "./test-utils.tsx";

function renderBanner(props: { readonly withActions: boolean }): HTMLElement {
  render(
    <DefaultBanner
      variant="info"
      inline
      title="Dealer view"
      testId="banner"
      {...(props.withActions && {
        actions: (
          <>
            <button type="button">One</button>
            <button type="button">Two</button>
            <button type="button">Three</button>
          </>
        ),
      })}
    >
      So sehen die Händler das Angebot
    </DefaultBanner>,
  );
  return screen.getByTestId("banner");
}

describe("DefaultBanner actions on narrow widths", () => {
  test("the row wraps, the text claims the line and the actions take their own line", () => {
    const banner = renderBanner({ withActions: true });
    expect(banner.className).toContain("max-sm:flex-wrap");
    const text = within(banner).getByText("So sehen die Händler das Angebot").parentElement;
    expect(text?.className).toContain("max-sm:basis-0");
    expect(text?.className).toContain("grow");
    const actions = banner.querySelector('[data-slot="actions"]');
    expect(actions?.className).toContain("max-sm:w-full");
    expect(actions?.className).toContain("flex-wrap");
    expect(actions?.previousElementSibling).toBe(text);
  });

  test("a banner without actions keeps the plain row", () => {
    const banner = renderBanner({ withActions: false });
    expect(banner.className).not.toContain("max-sm:flex-wrap");
  });
});
