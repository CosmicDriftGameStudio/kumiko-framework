// actionForm info band, label badges, chip multi-select and aiAssist.contextFields.

import { afterEach, describe, expect, jest, test } from "bun:test";
import type {
  ActionFormScreenDefinition,
  EntityDefinition,
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Dispatcher } from "../../headless/index.ts";
import type { FeatureSchema } from "../../index.ts";
import {
  DispatcherProvider,
  KumikoScreen,
  NavProvider,
  REFERENCE_SEARCH_DEBOUNCE_MS,
  RenderEdit,
} from "../../index.ts";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.tsx";

const FORM: ActionFormScreenDefinition = {
  id: "reply",
  type: "actionForm",
  handler: "swap:write:reply",
  fields: { text: { type: "longText" } },
  layout: { sections: [{ fields: ["text"] }] },
  infoBand: "reply.band",
  fieldBadges: { text: { label: "reply.badge", tone: "warn" } },
};

describe("actionForm infoBand and fieldBadges", () => {
  test("the band shows above the fields and the badge sits next to the label", async () => {
    const schema: FeatureSchema = { featureName: "swap", entities: {}, screens: [FORM] };
    render(
      <DispatcherProvider dispatcher={createMockDispatcher({})}>
        <NavProvider
          value={{
            route: { screenId: "swap:screen:reply" },
            navigate: () => {},
            replace: () => {},
            hrefFor: () => "",
            searchParams: {},
            setSearchParams: () => {},
          }}
        >
          <KumikoScreen
            schema={schema}
            qn="swap:screen:reply"
            translate={(key) =>
              ({ "reply.band": "The AI prepared everything", "reply.badge": "Price source open" })[
                key
              ] ?? key
            }
          />
        </NavProvider>
      </DispatcherProvider>,
    );
    const band = await screen.findByTestId("kumiko-screen-action-form-info-band");
    expect(band.textContent).toContain("The AI prepared everything");
    expect(screen.getByTestId("field-badge-text").textContent).toBe("Price source open");
  });
});

const SCREEN: EntityEditScreenDefinition = {
  id: "demo:screen:ask",
  type: "entityEdit",
  entity: "ask",
  layout: {
    sections: [
      {
        title: "Ask",
        fields: [
          { field: "kinds" },
          {
            field: "note",
            aiAssist: {
              query: "demo:query:draft",
              resultField: "message",
              contextFields: ["kinds"],
              chips: [{ label: "Shorter", params: { style: "short" } }],
            },
          },
        ],
      },
    ],
  },
};

const entityWithChips = {
  fields: {
    note: { type: "longText" },
    kinds: { type: "multiSelect", options: ["front", "back", "label"], display: "chips" },
  },
} as unknown as EntityDefinition;

describe("multiSelect display chips and aiAssist.contextFields", () => {
  test("toggling a chip shows a check, and re-runs the AI query with the selection", async () => {
    const calls: { type: string; payload: unknown }[] = [];
    const query = (async (type: string, payload: unknown) => {
      calls.push({ type, payload });
      return { isSuccess: true, data: { message: `Draft ${calls.length}` } };
    }) as unknown as Dispatcher["query"];
    render(
      <DispatcherProvider dispatcher={createMockDispatcher({ query })}>
        <RenderEdit
          screen={SCREEN}
          entity={entityWithChips}
          featureName="demo"
          initial={{ note: "", kinds: ["front"] }}
          writeCommand="ask:create"
        />
      </DispatcherProvider>,
    );
    const user = userEvent.setup();
    expect(screen.getByTestId("field-kinds").textContent).toContain("✓ front");
    expect(calls).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: /back/ }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({
      type: "demo:query:draft",
      payload: { kinds: ["front", "back"] },
    });
    expect(screen.getByTestId("field-kinds").textContent).toContain("✓ back");
    await waitFor(() =>
      expect(
        (screen.getByTestId("field-note").querySelector("textarea") as HTMLTextAreaElement).value,
      ).toBe("Draft 1"),
    );
  });

  function renderAsk(initial: Record<string, unknown>) {
    const calls: { type: string; payload: unknown }[] = [];
    const query = (async (type: string, payload: unknown) => {
      calls.push({ type, payload });
      return { isSuccess: true, data: { message: "Draft" } };
    }) as unknown as Dispatcher["query"];
    render(
      <DispatcherProvider dispatcher={createMockDispatcher({ query })}>
        <RenderEdit
          screen={SCREEN}
          entity={entityWithChips}
          featureName="demo"
          initial={initial}
          writeCommand="ask:create"
        />
      </DispatcherProvider>,
    );
    return calls;
  }

  describe("with fake timers", () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    test("a changed context never replaces text the user wrote", async () => {
      jest.useFakeTimers();
      const calls = renderAsk({ note: "my own text", kinds: ["front"] });

      await userEvent
        .setup({ advanceTimers: jest.advanceTimersByTime })
        .click(screen.getByRole("button", { name: /back/ }));

      await waitFor(() =>
        expect(screen.getByTestId("field-kinds").textContent).toContain("✓ back"),
      );
      act(() => {
        jest.advanceTimersByTime(REFERENCE_SEARCH_DEBOUNCE_MS + 150);
      });
      expect(calls).toHaveLength(0);
      expect(
        (screen.getByTestId("field-note").querySelector("textarea") as HTMLTextAreaElement).value,
      ).toBe("my own text");
    });
  });

  test("a stored value outside the options survives a chip click", async () => {
    const calls = renderAsk({ note: "", kinds: ["legacy", "front"] });

    await userEvent.setup().click(screen.getByRole("button", { name: /back/ }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.payload).toEqual({ kinds: ["front", "back", "legacy"] });
  });
});

describe("actionForm summary.paramsFromLoad", () => {
  test("a placeholder is filled from a load field that is not a form field", async () => {
    const form: ActionFormScreenDefinition = {
      id: "reply",
      type: "actionForm",
      handler: "swap:write:reply",
      fields: { text: { type: "longText" } },
      layout: { sections: [{ fields: ["text"] }] },
      load: { query: "swap:query:request:detail" },
      summary: { title: "summary.title", paramsFromLoad: ["buyerName"] },
    };
    const schema: FeatureSchema = { featureName: "swap", entities: {}, screens: [form] };
    const query = (async () => ({
      isSuccess: true,
      data: { text: "", buyerName: "Marta" },
    })) as unknown as Dispatcher["query"];
    render(
      <DispatcherProvider dispatcher={createMockDispatcher({ query })}>
        <NavProvider
          value={{
            route: { screenId: "swap:screen:reply" },
            navigate: () => {},
            replace: () => {},
            hrefFor: () => "",
            searchParams: {},
            setSearchParams: () => {},
          }}
        >
          <KumikoScreen
            schema={schema}
            qn="swap:screen:reply"
            entityId="r1"
            translate={(key, params) =>
              key === "summary.title" ? `Reply to ${params?.["buyerName"]}` : key
            }
          />
        </NavProvider>
      </DispatcherProvider>,
    );
    expect(await screen.findByText("Reply to Marta")).toBeDefined();
  });
});

describe("actionForm load.passPrefill", () => {
  function loadPayloads(passPrefill: boolean): Promise<unknown[]> {
    const loads: unknown[] = [];
    const form: ActionFormScreenDefinition = {
      id: "pick-form",
      type: "actionForm",
      handler: "fleet:write:pick",
      fields: { vehicleId: { type: "text" }, note: { type: "text" } },
      layout: { sections: [{ fields: ["note"] }] },
      load: { query: "fleet:query:pick:load", ...(passPrefill && { passPrefill: true }) },
    };
    const list: EntityListScreenDefinition = {
      id: "trip-list",
      type: "entityList",
      entity: "trip",
      columns: ["title"],
      rowActions: [
        {
          kind: "drawer",
          id: "pick",
          label: "Pick",
          screen: "pick-form",
          params: { map: { id: "id", vehicleId: "id" } },
        },
      ],
    };
    const schema: FeatureSchema = {
      featureName: "fleet",
      entities: { trip: { fields: { title: { type: "text" } } } as never },
      screens: [list, form],
    };
    const query = (async (type: string, payload: unknown) => {
      if (type === "fleet:query:pick:load") {
        loads.push(payload);
        return { isSuccess: true, data: { note: "" } };
      }
      return { isSuccess: true, data: { rows: [{ id: "r1", title: "Alpha" }], nextCursor: null } };
    }) as unknown as Dispatcher["query"];
    render(
      <DispatcherProvider dispatcher={createMockDispatcher({ query })}>
        <KumikoScreen schema={schema} qn="fleet:screen:trip-list" />
      </DispatcherProvider>,
    );
    return waitFor(() => screen.getByTestId("row-r1-action-pick"))
      .then((button) => userEvent.setup().click(button))
      .then(() => waitFor(() => expect(loads.length).toBeGreaterThan(0)))
      .then(() => loads);
  }

  test("the drawer's prefill values travel in the load payload", async () => {
    const loads = await loadPayloads(true);
    expect(loads[0]).toMatchObject({ vehicleId: "r1" });
  });

  test("without the opt-in the load payload stays as before", async () => {
    const loads = await loadPayloads(false);
    expect(loads[0]).not.toHaveProperty("vehicleId");
  });
});

describe("aiAssist.noteField", () => {
  test("the note shows under the field and goes away with the next result without one", async () => {
    let call = 0;
    const query = (async () => {
      call += 1;
      return {
        isSuccess: true,
        data: call === 1 ? { message: "Draft", hint: "Could not rewrite" } : { message: "Draft 2" },
      };
    }) as unknown as Dispatcher["query"];
    const screenDef: EntityEditScreenDefinition = {
      id: "demo:screen:note",
      type: "entityEdit",
      entity: "ask",
      layout: {
        sections: [
          {
            title: "Ask",
            fields: [
              {
                field: "note",
                aiAssist: {
                  query: "demo:query:draft",
                  resultField: "message",
                  noteField: "hint",
                  chips: [{ label: "Shorter", params: { style: "short" } }],
                },
              },
            ],
          },
        ],
      },
    };
    render(
      <DispatcherProvider dispatcher={createMockDispatcher({ query })}>
        <RenderEdit
          screen={screenDef}
          entity={{ fields: { note: { type: "longText" } } } as never}
          featureName="demo"
          initial={{ note: "" }}
          writeCommand="ask:create"
        />
      </DispatcherProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId("field-ai-chip-note-0"));
    expect((await screen.findByTestId("field-ai-note-note")).textContent).toBe("Could not rewrite");
    await user.click(screen.getByTestId("field-ai-chip-note-0"));
    await waitFor(() => expect(screen.queryByTestId("field-ai-note-note")).toBeNull());
  });
});
