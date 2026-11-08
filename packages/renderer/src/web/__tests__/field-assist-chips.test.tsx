import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";

import userEvent from "@testing-library/user-event";
import { RelatedPhotoGrid } from "../../components/related-photo-grid.tsx";
import type { Dispatcher } from "../../headless/index.ts";
import { DispatcherProvider, RenderEdit } from "../../index.ts";
import { DefaultRecordSummary } from "../primitives/record-summary.tsx";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.tsx";

const entity = {
  fields: {
    note: { type: "longText" },
    price: { type: "money" },
    seats: { type: "number" },
    suggestions: { type: "jsonb" },
  },
} as unknown as EntityDefinition;

const SCREEN: EntityEditScreenDefinition = {
  id: "demo:screen:offer-edit",
  type: "entityEdit",
  entity: "offer",
  layout: {
    sections: [
      {
        title: "Offer",
        fields: [
          { field: "suggestions", visible: false },
          {
            field: "note",
            aiAssist: {
              query: "demo:query:draft-note",
              resultField: "message",
              chips: [
                { label: "Shorter", params: { style: "short" } },
                { label: "Warranty", params: { mentionWarranty: true } },
              ],
              prompt: { param: "instruction", placeholder: "Tell the AI" },
            },
          },
          { field: "price", valueChips: { from: "suggestions" } },
          { field: "seats", suffix: "seats", valueChips: { from: "suggestions" } },
        ],
      },
    ],
  },
};

function renderOffer(query: Dispatcher["query"] | undefined) {
  const dispatcher = createMockDispatcher(query === undefined ? {} : { query });
  return render(
    <DispatcherProvider dispatcher={dispatcher}>
      <RenderEdit
        screen={SCREEN}
        entity={entity}
        featureName="demo"
        initial={{ note: "hi there", price: null, seats: null, suggestions: [3, 5] }}
        writeCommand="offer:create"
      />
    </DispatcherProvider>,
  );
}

function recordingQuery(result: unknown = { isSuccess: true, data: { message: "Drafted" } }) {
  const calls: { type: string; payload: unknown }[] = [];
  const query = (async (type: string, payload: unknown) => {
    calls.push({ type, payload });
    return result;
  }) as unknown as Dispatcher["query"];
  return { query, calls };
}

function noteInput(): HTMLTextAreaElement {
  const el = screen.getByTestId("field-note").querySelector("textarea");
  if (!el) throw new Error("expected the note textarea");
  return el;
}

describe("aiAssist", () => {
  test("a chip runs the configured query with its params and writes the result field back", async () => {
    const { query, calls } = recordingQuery();
    renderOffer(query);

    await userEvent.setup().click(screen.getByTestId("field-ai-chip-note-0"));

    await waitFor(() => expect(noteInput().value).toBe("Drafted"));
    expect(calls[0]).toEqual({ type: "demo:query:draft-note", payload: { style: "short" } });
  });

  test("chips stack, a second click takes the chip out again, the prompt adds the instruction", async () => {
    const { query, calls } = recordingQuery();
    renderOffer(query);
    const user = userEvent.setup();

    await user.click(screen.getByTestId("field-ai-chip-note-0"));
    await waitFor(() => expect(calls).toHaveLength(1));
    await user.click(screen.getByTestId("field-ai-chip-note-1"));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]?.payload).toEqual({ style: "short", mentionWarranty: true });

    await user.click(screen.getByTestId("field-ai-chip-note-0"));
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2]?.payload).toEqual({ mentionWarranty: true });

    await user.type(screen.getByTestId("field-ai-prompt-note"), "friendlier");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(calls).toHaveLength(4));
    expect(calls[3]?.payload).toEqual({ mentionWarranty: true, instruction: "friendlier" });
  });

  test("a failing query shows the error banner and keeps the text", async () => {
    const { query } = recordingQuery({
      isSuccess: false,
      error: { code: "boom", message: "x", details: {} },
    });
    renderOffer(query);

    await userEvent.setup().click(screen.getByTestId("field-ai-chip-note-0"));

    await waitFor(() => expect(screen.getByTestId("field-ai-error-note")).toBeTruthy());
    expect(noteInput().value).toBe("hi there");
  });
});

describe("valueChips", () => {
  test("a chip sets a number field and a money field from the array field", async () => {
    renderOffer(undefined);
    const user = userEvent.setup();

    await user.click(screen.getByTestId("field-value-chip-seats-5"));
    await waitFor(() =>
      expect(screen.getByTestId("field-seats").querySelector("input")?.value).toBe("5"),
    );

    await user.click(screen.getByTestId("field-value-chip-price-3"));
    await waitFor(() =>
      expect(screen.getByTestId("field-price").querySelector("input")?.value).toMatch(/3/),
    );
  });

  test("a number chip reads like the field: the number followed by its suffix", () => {
    renderOffer(undefined);
    expect(screen.getByTestId("field-value-chip-seats-5").textContent).toBe("5 seats");
  });

  test("chip text follows the field type and the chip equal to the value is pressed with a check", async () => {
    renderOffer(undefined);
    const priceChip = screen.getByTestId("field-value-chip-price-3");
    expect(priceChip.textContent).toMatch(/3/);
    expect(priceChip.textContent).toMatch(/\$|€|USD|EUR/);
    expect(priceChip.getAttribute("aria-pressed")).toBe("false");

    await userEvent.setup().click(priceChip);
    const pressedChip = () => screen.getByTestId("field-value-chip-price-3");
    await waitFor(() => expect(pressedChip().getAttribute("aria-pressed")).toBe("true"));
    expect(pressedChip().textContent).toContain("✓");
    expect(screen.getByTestId("field-value-chip-price-5").getAttribute("aria-pressed")).toBe(
      "false",
    );
  });
});

describe("RecordSummary icon", () => {
  test("draws the sentence led by the icon without the bordered box", () => {
    const { container } = render(
      <DefaultRecordSummary text="AI says so" icon="sparkles" testId="summary" />,
    );
    expect(screen.getByTestId("summary").textContent).toBe("AI says so");
    expect(container.querySelector("svg")).not.toBeNull();
    expect(screen.getByTestId("summary").className).not.toContain("border");
  });
});

describe("RelatedPhotoGrid", () => {
  test("one tile per row with the row's actions and a hidden action for a row it does not fit", async () => {
    const triggered: string[] = [];
    render(
      <RelatedPhotoGrid
        rows={[
          { id: "a", photo: "00000000-0000-4000-8000-000000000001", label: "Front" },
          { id: "b", photo: "00000000-0000-4000-8000-000000000002", label: "Back" },
        ]}
        photoGrid={{ imageField: "photo", captionField: "label" }}
        rowActions={[
          {
            id: "remove",
            label: "Remove",
            onTrigger: (row) => {
              triggered.push(row.id);
            },
            isVisible: (row) => row.id === "a",
          },
        ]}
        onActionError={() => {}}
        testId="grid"
      />,
    );
    expect(screen.getByText("Front")).toBeTruthy();
    expect(screen.getByText("Back")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(1);
    await userEvent.setup().click(screen.getByRole("button", { name: "Remove" }));
    expect(triggered).toEqual(["a"]);
  });
});
