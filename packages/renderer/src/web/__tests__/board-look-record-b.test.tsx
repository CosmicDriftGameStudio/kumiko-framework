// Board look of record pages, part B: photo grid tiles, destructive header actions in the
// overflow menu, next-step button, multiline and above-title list columns, compact configEdit.
import { describe, expect, test } from "bun:test";
import type { ConfigEditScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import userEvent from "@testing-library/user-event";
import { HeaderActionsBar } from "../../app/header-actions-bar.tsx";
import type { Dispatcher } from "../../headless/index.ts";
import { DispatcherProvider, KumikoScreen, usePrimitives } from "../../index.ts";
import { DefaultPhotoGrid } from "../primitives/photo-grid.tsx";
import { DefaultRecordSteps } from "../primitives/record-steps.tsx";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.tsx";

describe("photo grid tiles", () => {
  test("a tile shows its badge on the image and the caption below", () => {
    render(
      <DefaultPhotoGrid
        testId="grid"
        tiles={[
          { id: "a", imageId: "f1", caption: "Front", badge: "Blurry" },
          { id: "b", imageId: "f2", caption: "Photo 2" },
        ]}
      />,
    );
    const tileA = screen.getByTestId("grid-tile-a");
    const badge = tileA.querySelector("[data-slot=photo-badge]");
    expect(badge?.textContent).toBe("Blurry");
    expect(badge?.className).toContain("text-status-warn");
    expect(tileA.textContent).toContain("Front");
    expect(screen.getByTestId("grid-tile-b").querySelector("[data-slot=photo-badge]")).toBeNull();
  });

  test("tiles stand in two columns on a phone and three from md", () => {
    render(<DefaultPhotoGrid testId="grid" tiles={[{ id: "a", imageId: "f1" }]} />);
    const cls = screen.getByTestId("grid").className;
    expect(cls).toContain("[grid-template-columns:repeat(2,minmax(0,1fr))]");
    expect(cls).toContain("md:[grid-template-columns:repeat(3,minmax(0,1fr))]");
  });

  test("caption and actions share one row, caption first, actions pushed right", () => {
    render(
      <DefaultPhotoGrid
        testId="grid"
        tiles={[
          {
            id: "a",
            imageId: "f1",
            caption: "Front",
            actions: <button type="button">Remove</button>,
          },
        ]}
      />,
    );
    const row = screen.getByText("Front").parentElement as HTMLElement;
    expect(row.className).toContain("flex-wrap");
    expect(row.className).not.toContain("flex-col");
    const actions = screen.getByText("Remove").parentElement as HTMLElement;
    expect(actions.parentElement).toBe(row);
    expect(actions.className).toContain("ml-auto");
    expect(row.firstElementChild).toBe(screen.getByText("Front"));
  });
});

function Bar(): React.ReactNode {
  const { Button, Dialog, ActionOverflowMenu } = usePrimitives();
  return (
    <HeaderActionsBar
      collapseAfterPrimary
      Button={Button}
      Dialog={Dialog}
      ActionOverflowMenu={ActionOverflowMenu}
      onError={() => {}}
      actions={[
        { id: "approve", label: "Approve", style: "primary", onPress: () => {} },
        { id: "remove", label: "Delete", style: "danger", onPress: () => {} },
      ]}
    />
  );
}

describe("header actions", () => {
  test("a destructive action is an item of the overflow menu, not a head button", async () => {
    render(<Bar />);
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
    await userEvent
      .setup()
      .click(screen.getByTestId("kumiko-screen-projection-detail-actions-overflow"));
    expect(await screen.findByText("Delete")).toBeTruthy();
  });
});

describe("next step", () => {
  test("the action button is 36px high, the more-actions chips wrap", () => {
    render(
      <DefaultRecordSteps
        testId="steps"
        title="Next step"
        emptyLabel=""
        reasonLabel="Why"
        items={[
          {
            id: "s1",
            title: "Call",
            actions: <button type="button">Go</button>,
            moreActions: <button type="button">Later</button>,
          },
        ]}
        moreActionsLabel="Clarify first?"
      />,
    );
    const actions = screen.getByText("Go").parentElement;
    expect(actions?.className).toContain("[&_button]:h-9");
    const chips = screen.getByText("Later").parentElement;
    expect(chips?.className).toContain("flex-wrap");
    expect(chips?.className).not.toContain("grid-cols-2");
  });
});

const compactScreen: ConfigEditScreenDefinition = {
  id: "settings",
  type: "configEdit",
  scope: "tenant",
  compact: true,
  configKeys: { siteName: "demo:config:site-name" },
  fields: {
    siteName: { type: "text" },
    // @cast-boundary inline schema-author shape — FieldDefinition union too narrow
  } as ConfigEditScreenDefinition["fields"],
  layout: { sections: [{ title: "Basics", fields: ["siteName"] }] },
};

describe("configEdit compact", () => {
  test("caps the column and draws no origin line or accent bar", async () => {
    const dispatcher: Dispatcher = createMockDispatcher({
      query: (async (type: string) => ({
        isSuccess: true,
        data:
          type === "config:query:cascade"
            ? {
                "demo:config:site-name": {
                  levels: [{ source: "tenant", value: "Acme", isActive: true }],
                },
              }
            : { "demo:config:site-name": { value: "Acme", scope: "tenant" } },
      })) as unknown as Dispatcher["query"],
    });
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen
          schema={{ featureName: "demo", entities: {}, screens: [compactScreen] }}
          qn="demo:screen:settings"
        />
      </DispatcherProvider>,
    );
    await waitFor(() => screen.getByTestId("render-edit-form"));
    const compact = screen.getByTestId("config-edit-compact");
    expect(compact.className).toContain("max-w-[940px]");
    expect(compact.className).toContain("h-full");
    // The save bar is pinned below the capped column: full width, separator line, not inside the cap.
    const bar = screen.getByTestId("render-edit-form-unsaved").closest(".border-t");
    expect(bar).not.toBeNull();
    expect(bar?.closest("form")?.firstElementChild?.contains(bar as Node)).toBe(false);
    expect(screen.queryByTestId("config-cascade")).toBeNull();
    expect(document.querySelector("[data-testid$='-accent']")).toBeNull();
  });
});
