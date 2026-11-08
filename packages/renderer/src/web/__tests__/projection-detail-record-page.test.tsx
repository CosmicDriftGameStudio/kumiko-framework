// Record-page options of projectionDetail: tabLabel, writeForm submitWith, narrow-only
// presentation (hideOnNarrow, showOnNarrowOnly, titleOnNarrow, descriptionNarrow, narrowTabs)
// and the mobileSummary phone header.
import { describe, expect, mock, test } from "bun:test";
import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { ReactNode } from "react";
import type { Dispatcher } from "../../headless/index.ts";
import { DispatcherProvider, KumikoScreen } from "../../index.ts";
import { PageHeaderSlotProvider, usePageHeaderSlot } from "../layout/page-header-slot.tsx";
import { createMockDispatcher, fireEvent, render, screen, waitFor } from "./test-utils.tsx";

function renderScreen(
  definition: ProjectionDetailScreenDefinition,
  data: unknown,
  write?: Dispatcher["write"],
): void {
  const query = (async () => ({ isSuccess: true, data })) as unknown as Dispatcher["query"];
  render(
    <DispatcherProvider dispatcher={createMockDispatcher({ query, ...(write && { write }) })}>
      <PageHeaderSlotProvider>
        <KumikoScreen
          schema={{ featureName: "shop", entities: {}, screens: [definition] }}
          qn={`shop:screen:${definition.id}`}
          entityId="r1"
        />
      </PageHeaderSlotProvider>
    </DispatcherProvider>,
  );
}

const approval: ProjectionDetailScreenDefinition = {
  id: "approval",
  type: "projectionDetail",
  query: "shop:query:approval",
  layout: {
    mode: "tabs",
    narrowTabs: false,
    sections: [
      {
        id: "review",
        tabLabel: "Check",
        kind: "writeForm",
        title: "Decision",
        fieldDefs: { reason: { type: "text", required: true } },
        fields: ["reason"],
        handler: "shop:write:unused",
        submitWith: "approve",
      },
      { id: "history", tabLabel: "Log", title: "History", fields: ["name"] },
    ],
  },
  actions: [
    {
      kind: "writeHandler",
      id: "approve",
      label: "Approve",
      handler: "shop:write:approve",
      payload: { map: { noteId: "id" } },
      showOnTabs: ["review"],
    },
  ],
  footerActions: ["approve"],
};

const record = { id: "r1", name: "Anna" };

describe("writeForm section title", () => {
  test("a record page draws the title as the small uppercase label", async () => {
    renderScreen(
      {
        ...approval,
        layout: { sections: approval.layout.sections.filter((s) => s.kind === "writeForm") },
      },
      record,
    );
    const title = await screen.findByTestId("write-form-Decision-title");
    expect(title.className).toContain("uppercase");
  });
});

describe("tabLabel", () => {
  test("names the tab while the section keeps its title", async () => {
    renderScreen(approval, record);
    const tabs = await screen.findByTestId("kumiko-screen-projection-detail-tabs");
    expect(tabs.textContent).toContain("Check");
    expect(tabs.textContent).toContain("Log");
    expect(tabs.textContent).not.toContain("Decision");
  });
});

describe("narrowTabs: false", () => {
  test("hides the tab strip on the phone and shows the other tabs' sections there only", async () => {
    renderScreen(approval, record);
    const tabs = await screen.findByTestId("kumiko-screen-projection-detail-tabs");
    expect(tabs.closest("[class*='max-sm:hidden']")).not.toBeNull();
    const history = screen.getByText("Anna").closest("[class*='sm:hidden']");
    expect(history).not.toBeNull();
  });
});

describe("writeForm submitWith", () => {
  test("has no submit button of its own", async () => {
    renderScreen(approval, record);
    await screen.findByText("Approve");
    expect(screen.queryByTestId("write-form-section-submit")).toBeNull();
  });

  test("the action writes its payload plus the form values once, after validation", async () => {
    const write = mock(async () => ({
      isSuccess: true,
      data: {},
    })) as unknown as Dispatcher["write"];
    renderScreen(approval, record, write);
    const approve = await screen.findByText("Approve");
    fireEvent.click(approve);
    await waitFor(() => expect(screen.queryByText("Approve")).not.toBeNull());
    expect(write).not.toHaveBeenCalled();

    const input = screen.getByTestId("field-reason").querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "ok" } });
    fireEvent.click(screen.getByText("Approve"));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(write).toHaveBeenCalledWith("shop:write:approve", { noteId: "r1", reason: "ok" });
  });
});

describe("writeForm submitWith payload", () => {
  test("an untouched optional empty field is left out of the write, like on a normal submit", async () => {
    const w = mock(async () => ({ isSuccess: true, data: {} })) as unknown as Dispatcher["write"];
    const withOptional = {
      ...approval,
      layout: {
        ...approval.layout,
        sections: [
          {
            ...(approval.layout.sections[0] as object),
            fieldDefs: {
              reason: { type: "text", required: true },
              note: { type: "text" },
            },
            fields: ["reason", "note"],
          },
          approval.layout.sections[1],
        ],
      },
    } as ProjectionDetailScreenDefinition;
    renderScreen(withOptional, { ...record, note: "" }, w);
    const input = (await screen.findByTestId("field-reason")).querySelector(
      "input",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "ok" } });
    fireEvent.click(screen.getByText("Approve"));
    await waitFor(() => expect(w).toHaveBeenCalledTimes(1));
    expect(w).toHaveBeenCalledWith("shop:write:approve", { noteId: "r1", reason: "ok" });
  });
});

describe("writeForm hint and badge from the record", () => {
  test("a hintField and a badge field that the form does not hold show their record text and are not submitted", async () => {
    const w = mock(async () => ({ isSuccess: true, data: {} })) as unknown as Dispatcher["write"];
    const withHint = {
      ...approval,
      layout: {
        ...approval.layout,
        sections: [
          {
            ...(approval.layout.sections[0] as object),
            fieldDefs: { reason: { type: "text", required: true } },
            fields: [
              {
                field: "reason",
                hintField: "ownCarHint",
                badge: { field: "mileageHint", tone: "warn" },
              },
            ],
          },
          approval.layout.sections[1],
        ],
      },
    } as ProjectionDetailScreenDefinition;
    renderScreen(
      withHint,
      { ...record, ownCarHint: "Skoda Octavia", mileageHint: "Mileage open" },
      w,
    );
    expect(await screen.findByText("Skoda Octavia")).not.toBeNull();
    expect(screen.getByTestId("field-badge-reason").textContent).toContain("Mileage open");
    const input = screen.getByTestId("field-reason").querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "ok" } });
    fireEvent.click(screen.getByText("Approve"));
    await waitFor(() => expect(w).toHaveBeenCalledTimes(1));
    expect(w).toHaveBeenCalledWith("shop:write:approve", { noteId: "r1", reason: "ok" });
  });
});

describe("narrowTabs: false with a hideOnNarrow section of another tab", () => {
  test("it shows neither on the phone nor under the active tab on desktop", async () => {
    const def = {
      ...approval,
      layout: {
        ...approval.layout,
        sections: [
          approval.layout.sections[0],
          {
            id: "history",
            tabLabel: "Log",
            title: "History",
            hideOnNarrow: true,
            fields: ["name"],
          },
        ],
      },
    } as ProjectionDetailScreenDefinition;
    renderScreen(def, record);
    await screen.findByText("Approve");
    expect(screen.queryByText("Anna")).toBeNull();
  });
});

describe("writeForm submitWith with a form that is not usable", () => {
  const write = () =>
    mock(async () => ({ isSuccess: true, data: {} })) as unknown as Dispatcher["write"];

  test("a form hidden for the phone still blocks the write with a named field", async () => {
    const hidden: ProjectionDetailScreenDefinition = {
      ...approval,
      layout: {
        mode: "tabs",
        sections: [
          { ...(approval.layout.sections[0] as object), hideOnNarrow: true },
          { id: "history", title: "History", fields: ["name"] },
        ],
      },
    } as ProjectionDetailScreenDefinition;
    const w = write();
    renderScreen(hidden, record, w);
    fireEvent.click(await screen.findByText("Approve"));
    expect(await screen.findByText(/Please check: .*reason/i)).toBeTruthy();
    expect(w).not.toHaveBeenCalled();
  });
});

describe("narrow-only presentation", () => {
  const screenDef: ProjectionDetailScreenDefinition = {
    id: "facts",
    type: "projectionDetail",
    query: "shop:query:facts",
    layout: {
      sections: [
        { title: "Wide only", hideOnNarrow: true, fields: ["name"] },
        { title: "Phone only", showOnNarrowOnly: true, fields: ["name"] },
        {
          title: "Untitled on phone",
          titleOnNarrow: false,
          description: "Long text",
          descriptionNarrow: "Short text",
          fields: [{ field: "name", hideOnNarrow: true }, "city"],
        },
      ],
    },
  };

  test("sections and fields carry the responsive classes", async () => {
    renderScreen(screenDef, { id: "r1", name: "Anna", city: "Ulm" });
    await screen.findByText("Long text");
    const inSection = (text: string): HTMLElement => {
      const found = screen.getAllByText(text).find((el) => el.closest("section") !== null);
      if (found === undefined) throw new Error(`no section element for ${text}`);
      return found;
    };
    expect(inSection("Wide only").closest("[class*='max-sm:hidden']")).not.toBeNull();
    expect(inSection("Phone only").closest("[class*='sm:hidden']")).not.toBeNull();
    expect(
      inSection("Untitled on phone").closest("[class*='data-section-title']:not(section)"),
    ).not.toBeNull();
    expect(screen.getByText("Long text").className).toContain("max-sm:hidden");
    expect(screen.getByText("Short text").className).toContain("sm:hidden");
    expect(screen.getByText("Ulm").closest("[class*='max-sm:hidden']")).toBeNull();
  });
});

describe("mobileSummary", () => {
  const header = {
    id: "file",
    type: "projectionDetail",
    query: "shop:query:file",
    header: { title: "title", subtitle: "subtitle" },
    layout: { sections: [{ title: "Data", fields: ["name"] }] },
  } as const satisfies ProjectionDetailScreenDefinition;
  const data = { id: "r1", title: "Request", subtitle: "sub line", summary: "AI line", name: "A" };

  test("hides the subtitle on the phone when a mobileSummary is set", async () => {
    renderScreen({ ...header, mobileSummary: "summary" }, data);
    const subtitle = await screen.findByTestId("kumiko-screen-projection-detail-subtitle");
    expect(subtitle.closest("[class*='max-sm:hidden']")).not.toBeNull();
  });

  test("keeps the subtitle without a mobileSummary", async () => {
    renderScreen(header, data);
    const subtitle = await screen.findByTestId("kumiko-screen-projection-detail-subtitle");
    expect(subtitle.closest("[class*='max-sm:hidden']")).toBeNull();
  });
});

describe("photoGrid badgeFirst", () => {
  function renderPhotos(badgeFirst: boolean): void {
    const query = (async (type: string) =>
      type === "shop:query:photos"
        ? {
            isSuccess: true,
            data: {
              rows: [
                { id: "p1", file: "f1", label: "Plain one", flag: "" },
                { id: "p2", file: "f2", label: "Flagged", flag: "Blurry" },
                { id: "p3", file: "f3", label: "Plain two", flag: "" },
              ],
              nextCursor: null,
            },
          }
        : { isSuccess: true, data: { id: "r1" } }) as unknown as Dispatcher["query"];
    render(
      <DispatcherProvider dispatcher={createMockDispatcher({ query })}>
        <KumikoScreen
          schema={{
            featureName: "shop",
            entities: {},
            screens: [
              {
                id: "photos",
                type: "projectionDetail",
                query: "shop:query:file",
                layout: {
                  sections: [
                    {
                      kind: "relatedList",
                      title: "Photos",
                      query: "shop:query:photos",
                      parentParam: "fileId",
                      columns: [{ field: "label", label: "Label" }],
                      photoGrid: {
                        imageField: "file",
                        captionField: "label",
                        badgeField: "flag",
                        ...(badgeFirst && { badgeFirst: true as const }),
                      },
                    },
                  ],
                },
              },
            ],
          }}
          qn="shop:screen:photos"
          entityId="r1"
        />
      </DispatcherProvider>,
    );
  }

  const captionOrder = (): string[] =>
    ["Plain one", "Flagged", "Plain two"]
      .map((text) => ({ text, node: screen.getByText(text) }))
      .sort((a, b) =>
        a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
      )
      .map(({ text }) => text);

  test("moves tiles with a badge to the front on a phone only, the DOM order stays", async () => {
    renderPhotos(true);
    await screen.findByText("Flagged");
    expect(captionOrder()).toEqual(["Plain one", "Flagged", "Plain two"]);
    const tileOf = (text: string): string => screen.getByText(text).closest("li")?.className ?? "";
    expect(tileOf("Flagged")).toContain("max-sm:-order-1");
    expect(tileOf("Plain one")).not.toContain("-order-");
  });

  test("keeps the row order without it", async () => {
    renderPhotos(false);
    await screen.findByText("Flagged");
    expect(captionOrder()).toEqual(["Plain one", "Flagged", "Plain two"]);
  });
});

function SlotReader(): ReactNode {
  const slot = usePageHeaderSlot();
  return <output data-testid="slot-narrow">{slot?.narrowRecordTitle ?? "none"}</output>;
}

describe("header.narrowTitle", () => {
  test("reaches the page-header slot translated, next to the record title", async () => {
    const query = (async () => ({
      isSuccess: true,
      data: { id: "r1", title: "Long request title" },
    })) as unknown as Dispatcher["query"];
    render(
      <DispatcherProvider dispatcher={createMockDispatcher({ query })}>
        <PageHeaderSlotProvider>
          <SlotReader />
          <KumikoScreen
            schema={{
              featureName: "shop",
              entities: {},
              screens: [
                {
                  id: "file",
                  type: "projectionDetail",
                  query: "shop:query:file",
                  header: { title: "title", narrowTitle: "Request" },
                  layout: { sections: [{ title: "Data", fields: ["title"] }] },
                },
              ],
            }}
            qn="shop:screen:file"
            entityId="r1"
          />
        </PageHeaderSlotProvider>
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("slot-narrow").textContent).toBe("Request"));
  });
});
