import { describe, expect, mock, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { useState } from "react";
import * as z from "zod";
import { buildFormSchema } from "../../app/form-schema.ts";
import type { Dispatcher, SubmitResult } from "../../headless/index.ts";
import {
  DispatcherProvider,
  ExtensionSectionsProvider,
  type ExtensionSubmitContext,
  RenderEdit,
  type RenderEditChangeState,
  useExtensionFormSubmit,
} from "../../index.ts";
import { ScreenWidthProvider } from "../primitives/index.tsx";
import {
  Button,
  makeDispatcher,
  makeScreen,
  orderEntity,
  type TestValues,
} from "./_render-edit-helpers.tsx";
import { act, fireEvent, render, screen, within } from "./test-utils.tsx";

describe("RenderEdit", () => {
  test("renders a field per visible section entry with its resolved label", () => {
    const dispatcher = makeDispatcher();
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 0, isUrgent: false }}
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );

    // Visible: title, count, isUrgent. notes hidden because isUrgent=false.
    expect(screen.getByTestId("field-title")).toBeTruthy();
    expect(screen.getByTestId("field-count")).toBeTruthy();
    expect(screen.getByTestId("field-isUrgent")).toBeTruthy();
    expect(screen.queryByTestId("field-notes")).toBeNull();
  });

  // submitVariant carries an actionForm's submitStyle through to the
  // submit button — "danger" for a destructive handler (terminate, revoke).
  test("submitVariant='danger' renders the destructive submit button; default stays primary", () => {
    const { rerender } = render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 0, isUrgent: false }}
          writeCommand="order:create"
          submitVariant="danger"
        />
      </DispatcherProvider>,
    );
    expect(screen.getByTestId("render-edit-submit").getAttribute("data-variant")).toBe(
      "destructive",
    );

    rerender(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 0, isUrgent: false }}
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );
    expect(screen.getByTestId("render-edit-submit").getAttribute("data-variant")).toBe("default");
  });

  // A hidden field must not leave an empty grid cell behind — the cell count
  // has to track the visible field count exactly, in both directions.
  test("a hidden field claims no grid cell; toggling visibility adds/removes exactly one cell", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 0, isUrgent: false }}
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );

    const grid = screen.getByTestId("section-Basics").querySelector(".grid");
    expect(grid).toBeTruthy();
    // notes is hidden (isUrgent=false): title, count, isUrgent → 3 cells.
    expect(grid?.children.length).toBe(3);

    const urgentSwitch = screen.getByTestId("field-isUrgent").querySelector('[role="switch"]');
    fireEvent.click(urgentSwitch as HTMLElement);

    // notes becomes visible → 4 cells, no leftover empty cell from before.
    expect(grid?.children.length).toBe(4);
  });

  // A section's optional `description` renders as the
  // Section's subtitle slot underneath the block heading, and a field's
  // `icon` reaches the DOM as a prefix icon on its input.
  test("section.description renders as the section subtitle; field.icon renders a prefix icon", () => {
    const entity = {
      fields: { email: { type: "text", required: true } },
    } as unknown as EntityDefinition;
    const screenDef: EntityEditScreenDefinition = {
      id: "orders:screen:order-edit",
      type: "entityEdit",
      entity: "order",
      layout: {
        sections: [
          {
            title: "Contact",
            description: "How we'll reach you.",
            columns: 1,
            fields: [{ field: "email", icon: "mail" }],
          },
        ],
      },
    };
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit
          screen={screenDef}
          entity={entity}
          featureName="orders"
          initial={{ email: "" } as never}
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );

    expect(screen.getByTestId("section-Contact-subtitle").textContent).toBe("How we'll reach you.");
    const fieldEl = screen.getByTestId("field-email");
    expect(fieldEl.querySelector("svg[aria-hidden='true']")).not.toBeNull();
    expect(fieldEl.querySelector("input")?.className).toContain("pl-8");
  });

  // Fall 2: tabs layout sets hideSectionTitles (kumiko-screen.tsx's
  // ProjectionDetailBody, the only real caller) to blank out each section's
  // OWN title — the active tab already names it. The head card also carries
  // screen.description as its subtitle, so it must not render again here.
  test("tabs layout (hideSectionTitles) keeps the section title hidden and drops the screen's own subtitle", () => {
    const entity = {
      fields: { email: { type: "text", required: true } },
    } as unknown as EntityDefinition;
    const screenDef: EntityEditScreenDefinition = {
      id: "orders:screen:order-detail",
      type: "entityEdit",
      entity: "order",
      description: "Everything about this order in one place.",
      layout: {
        mode: "tabs",
        sections: [{ id: "contact", title: "Contact", fields: [{ field: "email" }] }],
      },
    };
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit
          screen={screenDef}
          entity={entity}
          featureName="orders"
          initial={{ email: "" } as never}
          writeCommand="order:create"
          hideSectionTitles
        />
      </DispatcherProvider>,
    );

    expect(screen.queryByTestId("render-edit-form-title")).toBeNull();
    expect(screen.queryByTestId("section-Contact-title")).toBeNull();
    expect(screen.queryByTestId("render-edit-form-subtitle")).toBeNull();
    // The Card itself must draw no title either —
    // the Tab strip right above already names this panel. The section had
    // no actions, so its Card renders with no header row at all.
    const card = screen.getByTestId("section-Contact");
    expect(card.querySelector("h3")).toBeNull();
    expect(card.textContent).not.toContain("Contact");
  });

  // A fields-kind section's `groups` splits it into its own titled cards
  // (tabs mode only — the branch that renders `groups` at all lives behind
  // `hideSectionTitles`) instead of one flat grid.
  test("a section with two groups renders two titled cards in tabs mode, each with its own fields", () => {
    const entity = {
      fields: {
        email: { type: "text", required: true },
        plan: { type: "text" },
      },
    } as unknown as EntityDefinition;
    const screenDef: EntityEditScreenDefinition = {
      id: "orders:screen:order-detail",
      type: "entityEdit",
      entity: "order",
      layout: {
        mode: "tabs",
        sections: [
          {
            id: "overview",
            title: "Overview",
            groups: [
              { title: "Contact", fields: [{ field: "email" }] },
              { title: "Billing", fields: [{ field: "plan" }] },
            ],
          },
        ],
      },
    };
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit
          screen={screenDef}
          entity={entity}
          featureName="orders"
          initial={{ email: "", plan: "" } as never}
          writeCommand="order:create"
          hideSectionTitles
        />
      </DispatcherProvider>,
    );

    const contactCard = screen.getByTestId("section-Overview-group-0");
    const billingCard = screen.getByTestId("section-Overview-group-1");
    expect(contactCard.querySelector("h3")?.textContent).toBe("Contact");
    expect(billingCard.querySelector("h3")?.textContent).toBe("Billing");
    expect(within(contactCard).getByTestId("field-email")).toBeTruthy();
    expect(within(billingCard).getByTestId("field-plan")).toBeTruthy();
    expect(within(contactCard).queryByTestId("field-plan")).toBeNull();

    // Default columns per group is 2 (--grid-cols CSS var), unless overridden.
    const contactGrid = contactCard.querySelector(".grid") as HTMLElement | null;
    expect(contactGrid?.style.getPropertyValue("--grid-cols")).toBe("repeat(2, minmax(0, 1fr))");
  });

  test("a tabs-mode section without groups renders a single card", () => {
    const entity = {
      fields: { email: { type: "text", required: true } },
    } as unknown as EntityDefinition;
    const screenDef: EntityEditScreenDefinition = {
      id: "orders:screen:order-detail",
      type: "entityEdit",
      entity: "order",
      layout: {
        mode: "tabs",
        sections: [{ id: "overview", title: "Overview", fields: [{ field: "email" }] }],
      },
    };
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit
          screen={screenDef}
          entity={entity}
          featureName="orders"
          initial={{ email: "" } as never}
          writeCommand="order:create"
          hideSectionTitles
        />
      </DispatcherProvider>,
    );

    expect(screen.getByTestId("section-Overview")).toBeTruthy();
    expect(screen.queryByTestId("section-Overview-group-0")).toBeNull();
    expect(within(screen.getByTestId("section-Overview")).getByTestId("field-email")).toBeTruthy();
  });

  // End-to-end routing: a `type:"locatedTimestamp"` entity field must pass through
  // computeEditViewModel → render-field → DefaultInput to reach the Located picker
  // (date + time + zone), rather than the plain-text fallthrough. The
  // `case "locatedTimestamp"` was missing, so the field rendered as text.
  test("locatedTimestamp field renders the located picker (date + time + zone), not plain text", () => {
    const entity = {
      fields: { pickup: { type: "locatedTimestamp", required: true } },
    } as unknown as EntityDefinition;
    const screenDef: EntityEditScreenDefinition = {
      id: "orders:screen:order-edit",
      type: "entityEdit",
      entity: "order",
      layout: { sections: [{ title: "When", columns: 1, fields: ["pickup"] }] },
    };
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit
          screen={screenDef}
          entity={entity}
          featureName="orders"
          initial={
            {
              pickup: {
                at: "2026-04-03T10:00:00",
                tz: "Europe/Lisbon",
                utc: "2026-04-03T09:00:00Z",
              },
            } as never
          }
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );

    const fieldEl = screen.getByTestId("field-pickup");
    const timeInput = fieldEl.querySelector<HTMLInputElement>('input[type="time"]');
    expect(timeInput).toBeTruthy();
    expect(timeInput?.value).toBe("10:00");
    expect(fieldEl.textContent ?? "").toMatch(/lokal|local/i);
  });

  test("typing in an input updates the form snapshot (controller + view-model round-trip)", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 0, isUrgent: false }}
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );

    const titleInput = screen.getByTestId("field-title").querySelector("input");
    expect(titleInput).toBeTruthy();
    fireEvent.change(titleInput as HTMLInputElement, { target: { value: "Acme" } });
    expect((titleInput as HTMLInputElement).value).toBe("Acme");
  });

  test("toggling isUrgent reveals the notes field (conditional predicate re-evaluates)", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 0, isUrgent: false }}
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );

    expect(screen.queryByTestId("field-notes")).toBeNull();
    // boolean field in a standard form = vendored Radix Switch → button[role=switch].
    const urgentSwitch = screen.getByTestId("field-isUrgent").querySelector('[role="switch"]');
    fireEvent.click(urgentSwitch as HTMLElement);
    expect(screen.queryByTestId("field-notes")).toBeTruthy();
  });

  test("a group-only field hidden by its visible condition does not block submit on its schema rule", async () => {
    const write = mock(async () => ({ isSuccess: true, data: { id: "42" } }) as never);
    const groupedScreen: EntityEditScreenDefinition = {
      id: "orders:screen:order-edit",
      type: "entityEdit",
      entity: "order",
      layout: {
        sections: [
          {
            groups: [
              {
                title: "Details",
                fields: [
                  "title",
                  "isUrgent",
                  { field: "notes", visible: { field: "isUrgent", eq: true } },
                ],
              },
            ],
          },
        ],
      },
    };
    render(
      <DispatcherProvider dispatcher={makeDispatcher(write)}>
        <RenderEdit<TestValues>
          screen={groupedScreen}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "Order", count: 0, isUrgent: false }}
          writeCommand="order:create"
          schema={z.object({ title: z.string(), notes: z.string().min(1) })}
        />
      </DispatcherProvider>,
    );

    expect(screen.queryByTestId("field-notes")).toBeNull();
    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Changed" } });
    await act(async () => {
      fireEvent.submit(screen.getByTestId("render-edit-form"));
      await Promise.resolve();
    });
    expect(write).toHaveBeenCalledTimes(1);
  });

  test("submit fires dispatcher.write with the current values; onSubmit receives the result", async () => {
    const write = mock(async () => ({ isSuccess: true, data: { id: "42" } }) as never);
    const dispatcher = makeDispatcher(write);
    const seenResults: SubmitResult<unknown>[] = [];

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 0, isUrgent: false }}
          writeCommand="order:create"
          onSubmit={(r) => seenResults.push(r)}
        />
      </DispatcherProvider>,
    );

    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Hello" } });

    const form = screen.getByTestId("render-edit-form");
    // `act` so the async state update React does after submit resolves
    // (flipping isDirty back to false after rebase) is flushed before
    // the assertions run.
    await act(async () => {
      fireEvent.submit(form);
      // microtask boundary for the handleSubmit promise chain
      await Promise.resolve();
    });

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith("order:create", expect.anything(), expect.anything());
    expect(seenResults).toHaveLength(1);
    expect(seenResults[0]?.isSuccess).toBe(true);
  });

  test("a field with submit:false is rendered and validated but not in the written payload", async () => {
    const write = mock(async () => ({ isSuccess: true, data: { id: "1" } })) as Dispatcher["write"];
    const screenDef: EntityEditScreenDefinition = {
      id: "orders:screen:order-edit",
      type: "entityEdit",
      entity: "order",
      layout: {
        sections: [{ fields: ["title", { field: "notes", submit: false }] }],
      },
    };

    render(
      <DispatcherProvider dispatcher={makeDispatcher(write)}>
        <RenderEdit<TestValues>
          screen={screenDef}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", notes: "display only" }}
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );

    expect(screen.getByTestId("field-notes")).toBeTruthy();
    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Hello" } });
    await act(async () => {
      fireEvent.submit(screen.getByTestId("render-edit-form"));
      await Promise.resolve();
    });

    expect(write).toHaveBeenCalledTimes(1);
    const payload = (write as unknown as { mock: { calls: [string, Record<string, unknown>][] } })
      .mock.calls[0]?.[1];
    expect(payload?.["title"]).toBe("Hello");
    expect(payload).not.toHaveProperty("notes");
  });

  describe("writeExcludedFields", () => {
    const excludedScreen: EntityEditScreenDefinition = {
      id: "orders:screen:order-edit",
      type: "entityEdit",
      entity: "order",
      layout: { sections: [{ fields: ["title", "notes"] }] },
      writeExcludedFields: { create: ["notes"], update: ["notes"] },
    };

    async function submitWith(entityId: string | undefined, initial: TestValues) {
      const write = mock(async () => ({
        isSuccess: true,
        data: { id: "1" },
      })) as Dispatcher["write"];
      render(
        <DispatcherProvider dispatcher={makeDispatcher(write)}>
          <RenderEdit<TestValues>
            screen={excludedScreen}
            entity={orderEntity}
            featureName="orders"
            initial={initial}
            writeCommand="order:write"
            {...(entityId !== undefined && { entityId })}
          />
        </DispatcherProvider>,
      );
      const titleInput = screen
        .getByTestId("field-title")
        .querySelector("input") as HTMLInputElement;
      fireEvent.change(titleInput, { target: { value: "Changed" } });
      await act(async () => {
        fireEvent.submit(screen.getByTestId("render-edit-form"));
        await Promise.resolve();
      });
      expect(write).toHaveBeenCalledTimes(1);
      return (write as unknown as { mock: { calls: [string, Record<string, unknown>][] } }).mock
        .calls[0]?.[1];
    }

    test("create hides the excluded field and never submits its seeded value", async () => {
      const payload = await submitWith(undefined, { title: "", notes: "seeded default" });
      expect(screen.queryByTestId("field-notes")).toBeNull();
      expect(payload?.["title"]).toBe("Changed");
      expect(payload).not.toHaveProperty("notes");
    });

    test("update shows the excluded field read-only and omits its unchanged value from the payload", async () => {
      const payload = await submitWith("42", { title: "Old", notes: "stored value" });
      const notesInput = screen
        .getByTestId("field-notes")
        .querySelector("input") as HTMLInputElement;
      expect(notesInput.value).toBe("stored value");
      expect(notesInput.disabled || notesInput.readOnly).toBe(true);
      expect(payload?.["title"]).toBe("Changed");
      expect(payload).not.toHaveProperty("notes");
    });

    test("create does not block on a required field it hides, and never submits it", async () => {
      const requiredEntity = {
        fields: {
          title: { type: "text", required: true },
          slug: { type: "text", required: true },
        },
      } as unknown as EntityDefinition;
      const requiredScreen: EntityEditScreenDefinition = {
        id: "orders:screen:order-edit",
        type: "entityEdit",
        entity: "order",
        layout: { sections: [{ fields: ["title", "slug"] }] },
        writeExcludedFields: { create: ["slug"] },
      };
      const write = mock(async () => ({
        isSuccess: true,
        data: { id: "1" },
      })) as Dispatcher["write"];
      render(
        <DispatcherProvider dispatcher={makeDispatcher(write)}>
          <RenderEdit<TestValues>
            screen={requiredScreen}
            entity={requiredEntity}
            featureName="orders"
            initial={{ title: "", slug: "" }}
            schema={buildFormSchema(requiredEntity, requiredScreen, "create")}
            writeCommand="order:write"
          />
        </DispatcherProvider>,
      );
      expect(screen.queryByTestId("field-slug")).toBeNull();
      const titleInput = screen
        .getByTestId("field-title")
        .querySelector("input") as HTMLInputElement;
      fireEvent.change(titleInput, { target: { value: "Hello" } });
      expect((screen.getByTestId("render-edit-submit") as HTMLButtonElement).disabled).toBe(false);
      await act(async () => {
        fireEvent.click(screen.getByTestId("render-edit-submit"));
        await Promise.resolve();
      });
      expect(write).toHaveBeenCalledTimes(1);
      const payload = (write as unknown as { mock: { calls: [string, Record<string, unknown>][] } })
        .mock.calls[0]?.[1];
      expect(payload?.["title"]).toBe("Hello");
      expect(payload).not.toHaveProperty("slug");
    });
  });

  test("a footer action applies its patch to the values, then submits them", async () => {
    const write = mock(async () => ({ isSuccess: true, data: { id: "1" } })) as Dispatcher["write"];
    const screenDef: EntityEditScreenDefinition = {
      id: "orders:screen:order-edit",
      type: "entityEdit",
      entity: "order",
      layout: { sections: [{ fields: ["title"] }] },
    };

    render(
      <DispatcherProvider dispatcher={makeDispatcher(write)}>
        <RenderEdit<TestValues>
          screen={screenDef}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "" }}
          writeCommand="order:create"
          footerActions={[{ id: "mark-urgent", label: "Mark urgent", patch: { isUrgent: true } }]}
        />
      </DispatcherProvider>,
    );

    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Hello" } });
    expect(write).toHaveBeenCalledTimes(0);
    await act(async () => {
      fireEvent.click(screen.getByTestId("render-edit-footer-action-mark-urgent"));
      await Promise.resolve();
    });

    expect(write).toHaveBeenCalledTimes(1);
    const payload = (write as unknown as { mock: { calls: [string, Record<string, unknown>][] } })
      .mock.calls[0]?.[1];
    expect(payload?.["title"]).toBe("Hello");
    expect(payload?.["isUrgent"]).toBe(true);
  });

  test("layout.width defaults the form shell to max-w-4xl when unset", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 0, isUrgent: false }}
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );

    const shell = screen.getByTestId("render-edit-form").firstElementChild;
    expect(shell?.className).toContain("max-w-4xl");
    expect(shell?.className).not.toContain("max-w-3xl");
  });

  test("layout.width: '3xl' narrows the form shell when set", () => {
    const screenDef = makeScreen();
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={{ ...screenDef, layout: { ...screenDef.layout, width: "3xl" } }}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 0, isUrgent: false }}
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );

    const shell = screen.getByTestId("render-edit-form").firstElementChild;
    expect(shell?.className).toContain("max-w-3xl");
    expect(shell?.className).not.toContain("max-w-full");
  });

  test("ScreenWidthProvider width='full' widens the form shell when layout.width is unset", () => {
    render(
      <ScreenWidthProvider width="full">
        <DispatcherProvider dispatcher={makeDispatcher()}>
          <RenderEdit<TestValues>
            screen={makeScreen()}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "", count: 0, isUrgent: false }}
            writeCommand="order:create"
          />
        </DispatcherProvider>
      </ScreenWidthProvider>,
    );

    const shell = screen.getByTestId("render-edit-form").firstElementChild;
    expect(shell?.className).toContain("max-w-full");
    expect(shell?.className).not.toContain("max-w-4xl");
  });

  function renderScreenForm(width: "full" | undefined): HTMLElement {
    render(
      <ScreenWidthProvider width={width}>
        <DispatcherProvider dispatcher={makeDispatcher()}>
          <RenderEdit<TestValues>
            screen={makeScreen()}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "", count: 0, isUrgent: false }}
            writeCommand="order:create"
            fillScreenHeight
          />
        </DispatcherProvider>
      </ScreenWidthProvider>,
    );
    const column = screen
      .getByTestId("render-edit-form-scroll")
      .querySelector<HTMLElement>(".max-w-full, .max-w-\\[640px\\]");
    if (column === null) throw new Error("screen-form column not found");
    return column;
  }

  test("ScreenWidthProvider width='full' widens the screen-form column of a default entityEdit", () => {
    const column = renderScreenForm("full");
    expect(column.className).toContain("max-w-full");
    expect(column.className).not.toContain("max-w-[640px]");
  });

  test("a screen-form column without screenWidth keeps the 640px default", () => {
    expect(renderScreenForm(undefined).className).toContain("max-w-[640px]");
  });

  test("layout.width: '3xl' overrides ScreenWidthProvider width='full'", () => {
    const screenDef = makeScreen();
    render(
      <ScreenWidthProvider width="full">
        <DispatcherProvider dispatcher={makeDispatcher()}>
          <RenderEdit<TestValues>
            screen={{ ...screenDef, layout: { ...screenDef.layout, width: "3xl" } }}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "", count: 0, isUrgent: false }}
            writeCommand="order:create"
          />
        </DispatcherProvider>
      </ScreenWidthProvider>,
    );

    const shell = screen.getByTestId("render-edit-form").firstElementChild;
    expect(shell?.className).toContain("max-w-3xl");
    expect(shell?.className).not.toContain("max-w-full");
  });

  test("Cancel button renders with the same hover-class family as a secondary button, not the link look", () => {
    render(
      <>
        <Button testId="secondary-reference" variant="secondary">
          Reference
        </Button>
        <DispatcherProvider dispatcher={makeDispatcher()}>
          <RenderEdit<TestValues>
            screen={makeScreen()}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "", count: 0, isUrgent: false }}
            writeCommand="order:create"
            onCancel={() => {}}
          />
        </DispatcherProvider>
      </>,
    );

    const reference = screen.getByTestId("secondary-reference");
    const cancel = screen.getByTestId("render-edit-cancel");
    const referenceHoverClass = reference.className
      .split(" ")
      .find((token) => token.startsWith("hover:"));

    expect(referenceHoverClass).toBeDefined();
    expect(cancel.className).toContain(referenceHoverClass as string);
    expect(cancel.className).not.toContain("h-auto");
    expect(cancel.className).not.toContain("px-0");
  });

  test("title resolved from i18n key `screen:<id>.title` with screenId as fallback", () => {
    const dispatcher = makeDispatcher();
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "", count: 0, isUrgent: false }}
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );
    // Default translation (the test setup has no bundle for screen:*.title)
    // → i18n returns the key itself, so RenderEdit detects this and displays
    // the screenId. This verifies the convention: no hardcoded "Untitled".
    const formTitle = screen.getByTestId("render-edit-form-title");
    expect(formTitle.textContent).toContain("orders:screen:order-edit");
  });

  test("extension section renders the registered Component with entityName + entityId", () => {
    const screenDef: EntityEditScreenDefinition = {
      id: "orders:screen:order-edit",
      type: "entityEdit",
      entity: "order",
      layout: {
        sections: [
          {
            title: "Basics",
            columns: 2,
            fields: [{ field: "title", span: 2 }],
          },
          {
            kind: "extension",
            title: "Custom Fields",
            component: { react: { __component: "MyCustomFieldsForm" } },
          },
        ],
      },
    };
    const MyCustomFieldsForm = ({
      entityName,
      entityId,
    }: {
      entityName: string;
      entityId: string | null;
    }) => (
      <div data-testid="my-custom-fields-form">
        {entityName}:{entityId ?? "(create)"}
      </div>
    );
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <ExtensionSectionsProvider value={{ MyCustomFieldsForm }}>
          <RenderEdit<TestValues>
            screen={screenDef}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "", count: 0, isUrgent: false, id: "row-42" } as TestValues}
            writeCommand="order:update"
          />
        </ExtensionSectionsProvider>
      </DispatcherProvider>,
    );

    expect(screen.getByTestId("section-extension-Custom Fields")).toBeTruthy();
    const mounted = screen.getByTestId("my-custom-fields-form");
    expect(mounted.textContent).toBe("order:row-42");
  });

  // Real update flow: EntityEditUpdateForm deliberately omits `id` from
  // the form values because `id` is not a declared field, and passes the route ID
  // through the entityId prop instead. Without this path, the section would fall
  // back to vm.id (=values["id"]=undefined) and incorrectly use create mode
  // during editing.
  test("extension section uses the entityId prop when id is absent from form values", () => {
    const screenDef: EntityEditScreenDefinition = {
      id: "orders:screen:order-edit",
      type: "entityEdit",
      entity: "order",
      layout: {
        sections: [
          { title: "Basics", columns: 2, fields: [{ field: "title", span: 2 }] },
          {
            kind: "extension",
            title: "Custom Fields",
            component: { react: { __component: "MyCustomFieldsForm" } },
          },
        ],
      },
    };
    const MyCustomFieldsForm = ({
      entityName,
      entityId,
    }: {
      entityName: string;
      entityId: string | null;
    }) => (
      <div data-testid="my-custom-fields-form">
        {entityName}:{entityId ?? "(create)"}
      </div>
    );
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <ExtensionSectionsProvider value={{ MyCustomFieldsForm }}>
          <RenderEdit<TestValues>
            screen={screenDef}
            entity={orderEntity}
            featureName="orders"
            // No id in the values (as in the real update form), but
            // the entityId prop carries the route ID.
            initial={{ title: "Existing", count: 0, isUrgent: false } as TestValues}
            entityId="order-99"
            writeCommand="order:update"
          />
        </ExtensionSectionsProvider>
      </DispatcherProvider>,
    );

    const mounted = screen.getByTestId("my-custom-fields-form");
    expect(mounted.textContent).toBe("order:order-99");
  });

  test("extension section without registered component shows the placeholder banner", () => {
    const screenDef: EntityEditScreenDefinition = {
      id: "orders:screen:order-edit",
      type: "entityEdit",
      entity: "order",
      layout: {
        sections: [
          {
            title: "Basics",
            columns: 1,
            fields: [{ field: "title", span: 1 }],
          },
          {
            kind: "extension",
            title: "Custom Fields",
            component: { react: { __component: "UnregisteredComp" } },
          },
        ],
      },
    };
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <ExtensionSectionsProvider value={{}}>
          <RenderEdit<TestValues>
            screen={screenDef}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "", count: 0, isUrgent: false }}
            writeCommand="order:create"
          />
        </ExtensionSectionsProvider>
      </DispatcherProvider>,
    );

    const placeholder = screen.getByTestId("section-extension-placeholder-Custom Fields");
    expect(placeholder.textContent).toContain("UnregisteredComp");
  });

  // ExtensionSectionProps.values/patch/validate pass-through —
  // same controller functions as RenderEditControls, just handed to
  // the extension section instead of onControlsReady.
  test("extension section sees current form values and its patch(...) lands in the form + outer onChange", () => {
    const screenDef: EntityEditScreenDefinition = {
      id: "orders:screen:order-edit",
      type: "entityEdit",
      entity: "order",
      layout: {
        sections: [
          { title: "Basics", columns: 2, fields: [{ field: "title", span: 2 }, "notes"] },
          {
            kind: "extension",
            title: "VIN Decode",
            component: { react: { __component: "VinDecodeSection" } },
          },
        ],
      },
    };
    const VinDecodeSection = ({
      values,
      patch,
      validate,
    }: {
      values?: Readonly<Record<string, unknown>>;
      patch?: (partial: Readonly<Record<string, unknown>>) => void;
      validate?: () => boolean;
    }) => (
      <div data-testid="vin-decode-section">
        <span data-testid="vin-decode-sees-title">{String(values?.["title"])}</span>
        <button type="button" onClick={() => patch?.({ notes: "decoded-from-vin" })}>
          Decode
        </button>
        <button
          type="button"
          data-testid="vin-decode-validate"
          onClick={() => {
            lastValidateResult = validate?.() ?? true;
          }}
        >
          Validate
        </button>
      </div>
    );
    const seen: RenderEditChangeState<TestValues>[] = [];
    let lastValidateResult = true;
    const schema = z.object({
      title: z.string().min(1),
      count: z.number().optional(),
      isUrgent: z.boolean().optional(),
    });
    const write = mock(async () => ({ isSuccess: true, data: { id: "1" } }) as never);
    render(
      <DispatcherProvider dispatcher={makeDispatcher(write)}>
        <ExtensionSectionsProvider value={{ VinDecodeSection }}>
          <RenderEdit<TestValues>
            screen={screenDef}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "", count: 0, isUrgent: false }}
            writeCommand="order:create"
            schema={schema}
            onChange={(state) => seen.push(state)}
          />
        </ExtensionSectionsProvider>
      </DispatcherProvider>,
    );

    act(() => {
      fireEvent.click(screen.getByTestId("vin-decode-validate"));
    });
    expect(lastValidateResult).toBe(false);
    expect(write).not.toHaveBeenCalled();
    expect(screen.getByTestId("field-title-errors")).toBeTruthy();

    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Acme" } });
    expect(screen.getByTestId("vin-decode-sees-title").textContent).toBe("Acme");

    act(() => {
      fireEvent.click(screen.getByText("Decode"));
    });

    const notesInput = screen.getByTestId("field-notes")?.querySelector("input");
    expect((notesInput as HTMLInputElement | null)?.value).toBe("decoded-from-vin");
    expect(seen.at(-1)?.values.notes).toBe("decoded-from-vin");
  });
});

describe("RenderEdit server validation errors (single-section)", () => {
  test("issue path matches a rendered field — field shows the error, no banner", async () => {
    const write = mock(
      async () =>
        ({
          isSuccess: false,
          error: {
            code: "validation_failed",
            httpStatus: 422,
            i18nKey: "kumiko.errors.validation",
            message: "Validation failed",
            details: {
              fields: [{ path: "title", code: "too_small", i18nKey: "kumiko.errors.required" }],
            },
          },
        }) as never,
    );
    render(
      <DispatcherProvider dispatcher={makeDispatcher(write)}>
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "Acme", count: 0, isUrgent: false }}
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );

    // Save stays disabled on an unchanged form.
    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Acme Corp" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("render-edit-submit"));
      await Promise.resolve();
    });

    expect(screen.getByTestId("field-title-errors")).toBeTruthy();
    expect(screen.queryByTestId("render-edit-form-error")).toBeNull();
  });

  test("issue path matches no rendered field — banner shows", async () => {
    const write = mock(
      async () =>
        ({
          isSuccess: false,
          error: {
            code: "validation_failed",
            httpStatus: 422,
            i18nKey: "kumiko.errors.validation",
            message: "Validation failed",
            details: {
              fields: [{ path: "version", code: "custom", i18nKey: "kumiko.errors.stale" }],
            },
          },
        }) as never,
    );
    render(
      <DispatcherProvider dispatcher={makeDispatcher(write)}>
        <RenderEdit<TestValues>
          screen={makeScreen()}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "Acme", count: 0, isUrgent: false }}
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );

    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Acme Corp" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("render-edit-submit"));
      await Promise.resolve();
    });

    expect(screen.getByTestId("render-edit-form-error")).toBeTruthy();
  });
});

describe("RenderEdit — composed extension save", () => {
  const screenDef: EntityEditScreenDefinition = {
    id: "orders:screen:order-edit",
    type: "entityEdit",
    entity: "order",
    layout: {
      sections: [
        { title: "Basics", columns: 2, fields: [{ field: "title", span: 2 }] },
        {
          kind: "extension",
          title: "Custom Fields",
          component: { react: { __component: "ComposedCF" } },
          contributesToFormSubmit: true,
        },
      ],
    },
  };

  function renderWith(
    submitSpy: (ctx: ExtensionSubmitContext) => void,
    writeSpy: Dispatcher["write"],
  ): void {
    const ComposedCF = (_: { entityName: string; entityId: string | null }) => {
      const [touched, setTouched] = useState(false);
      useExtensionFormSubmit({
        dirty: touched,
        onSubmit: async (ctx) => {
          submitSpy(ctx);
          return { isSuccess: true as const };
        },
      });
      return (
        <button type="button" data-testid="composed-touch" onClick={() => setTouched(true)}>
          touch
        </button>
      );
    };
    render(
      <DispatcherProvider dispatcher={makeDispatcher(writeSpy)}>
        <ExtensionSectionsProvider value={{ ComposedCF }}>
          <RenderEdit<TestValues>
            screen={screenDef}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "Existing", count: 0, isUrgent: false } as TestValues}
            entityId="order-99"
            writeCommand="order:update"
          />
        </ExtensionSectionsProvider>
      </DispatcherProvider>,
    );
  }

  test("Section-dirty enables the main save; CF-only save calls the handler without a main write", async () => {
    const submitSpy = mock();
    const writeSpy = mock(async () => ({
      isSuccess: true,
      data: { id: "order-99" },
    })) as unknown as Dispatcher["write"];
    renderWith(submitSpy, writeSpy);

    // The main form is unchanged and the section is not dirty, so Save is disabled.
    expect((screen.getByTestId("render-edit-submit") as HTMLButtonElement).disabled).toBe(true);

    // Section dirty machen → Save enabled (composed-dirty propagiert hoch).
    act(() => {
      fireEvent.click(screen.getByTestId("composed-touch"));
    });
    expect((screen.getByTestId("render-edit-submit") as HTMLButtonElement).disabled).toBe(false);

    // Save → the section handler receives entityId; no main write occurs because
    // the main form is unchanged.
    await act(async () => {
      fireEvent.click(screen.getByTestId("render-edit-submit"));
    });
    expect(submitSpy).toHaveBeenCalledWith({ entityId: "order-99" });
    expect(writeSpy).not.toHaveBeenCalled();
  });
});
