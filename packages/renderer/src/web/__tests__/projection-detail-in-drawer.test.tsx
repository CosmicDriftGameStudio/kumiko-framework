// A list row opens its projectionDetail (tabs, related tab, header actions) in a wide drawer.

import { describe, expect, mock, test } from "bun:test";
import type {
  ActionFormScreenDefinition,
  ProjectionDetailScreenDefinition,
  ProjectionListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import userEvent from "@testing-library/user-event";
import type { FeatureSchema, NavApi } from "../../index.ts";
import { DispatcherProvider, KumikoScreen, NavProvider } from "../../index.ts";
import {
  createMockDispatcher,
  type MockQueryHandler,
  type MockWriteHandler,
  render,
  screen,
  waitFor,
  within,
} from "./test-utils.tsx";

const offerList: ProjectionListScreenDefinition = {
  id: "offer-list",
  type: "projectionList",
  query: "offers:query:offer:list",
  columns: [{ field: "title", label: "offers:col:title" }],
  rowActions: [
    {
      kind: "drawer",
      id: "open-offer",
      label: "offers:action:open",
      screen: "offer-detail",
      rowClick: true,
      inMenu: false,
      width: "wide",
    },
  ],
};

const offerDetail: ProjectionDetailScreenDefinition = {
  id: "offer-detail",
  type: "projectionDetail",
  query: "offers:query:offer:detail",
  idParam: "offerId",
  layout: {
    mode: "tabs",
    sections: [
      { id: "details", tabLabel: "Details", title: "Details", fields: ["status"] },
      {
        id: "positions",
        tabLabel: "Positions",
        kind: "relatedList",
        title: "Positions",
        query: "offers:query:offer:positions",
        parentParam: "offerId",
        columns: [{ field: "label", label: "offers:col:label" }],
        rowActions: [
          {
            kind: "drawer",
            id: "add-note",
            label: "offers:action:add-note",
            screen: "position-note",
            params: { pick: ["label"] },
          },
        ],
      },
    ],
  },
  fieldLabels: { status: "offers:detail:status" },
  actions: [
    {
      kind: "writeHandler",
      id: "accept",
      label: "offers:action:accept",
      handler: "offers:write:offer:accept",
    },
  ],
};

const positionNote: ActionFormScreenDefinition = {
  id: "position-note",
  type: "actionForm",
  handler: "offers:write:position:note",
  fields: { label: { type: "text" }, note: { type: "text", required: true } },
  layout: { sections: [{ fields: ["label", "note"] }] },
};

const schema: FeatureSchema = {
  featureName: "offers",
  entities: {},
  screens: [offerList, offerDetail, positionNote],
};

type Harness = {
  readonly queries: { readonly type: string; readonly payload: unknown }[];
  readonly write: ReturnType<typeof mock<MockWriteHandler>>;
  readonly setSearchParams: ReturnType<typeof mock<NavApi["setSearchParams"]>>;
};

function renderList(): Harness {
  const queries: { type: string; payload: unknown }[] = [];
  let status = "draft";
  const query: MockQueryHandler = async (type: string, payload: unknown) => {
    queries.push({ type, payload });
    if (type === "offers:query:offer:list") {
      return {
        isSuccess: true,
        data: { rows: [{ id: "o1", title: "Offer 1" }], nextCursor: null },
      };
    }
    if (type === "offers:query:offer:detail") {
      return { isSuccess: true, data: { id: "o1", status } };
    }
    return {
      isSuccess: true,
      data: { rows: [{ id: "p1", label: "Position A" }], nextCursor: null },
    };
  };
  const write = mock<MockWriteHandler>(async (type: string) => {
    if (type === "offers:write:offer:accept") status = "accepted";
    return { isSuccess: true, data: {} };
  });
  const setSearchParams = mock<NavApi["setSearchParams"]>(() => {});
  const nav: NavApi = {
    route: { screenId: "offers:screen:offer-list" },
    navigate: () => {},
    replace: () => {},
    hrefFor: () => "",
    searchParams: {},
    setSearchParams,
  };
  render(
    <NavProvider value={nav}>
      <DispatcherProvider dispatcher={createMockDispatcher({ query, write })}>
        <KumikoScreen schema={schema} qn="offers:screen:offer-list" />
      </DispatcherProvider>
    </NavProvider>,
  );
  return { queries, write, setSearchParams };
}

const DETAIL_DRAWER = "toolbar-drawer-open-offer";

describe("detail drawer with unsent writeForm input", () => {
  test("closing asks before discarding the input, and keeps the drawer open meanwhile", async () => {
    const withWriteForm: FeatureSchema = {
      ...schema,
      screens: [
        offerList,
        {
          ...offerDetail,
          layout: {
            mode: "tabs",
            sections: [
              ...offerDetail.layout.sections,
              {
                id: "note",
                tabLabel: "Note",
                kind: "writeForm",
                title: "Add note",
                fieldDefs: { body: { type: "text" } },
                fields: ["body"],
                handler: "offers:write:offer:add-note",
              },
            ],
          },
        },
        positionNote,
      ],
    };
    const query: MockQueryHandler = async (type: string) =>
      type === "offers:query:offer:list"
        ? { isSuccess: true, data: { rows: [{ id: "o1", title: "Offer 1" }], nextCursor: null } }
        : { isSuccess: true, data: { id: "o1", status: "draft" } };
    render(
      <DispatcherProvider dispatcher={createMockDispatcher({ query })}>
        <KumikoScreen schema={withWriteForm} qn="offers:screen:offer-list" />
      </DispatcherProvider>,
    );
    await openDetail();
    const drawer = screen.getByTestId(DETAIL_DRAWER);
    const user = userEvent.setup();
    await waitFor(() => within(drawer).getByTestId("kumiko-screen-projection-detail-tabs-note"));
    await user.click(within(drawer).getByTestId("kumiko-screen-projection-detail-tabs-note"));
    const input = await waitFor(() => {
      const el = within(drawer).getByTestId("field-body").querySelector("input");
      if (el === null) throw new Error("expected an <input> inside field-body");
      return el;
    });
    await user.type(input, "unsent");

    await user.click(within(drawer).getByRole("button", { name: /close|schlie/i }));

    await waitFor(() => screen.getByTestId("drawer-discard-dialog"));
    expect(screen.getByTestId(DETAIL_DRAWER)).toBeTruthy();
  });
});

async function openDetail(): Promise<void> {
  await waitFor(() => screen.getByText("Offer 1"));
  await userEvent.setup().click(screen.getByText("Offer 1"));
  await waitFor(() => screen.getByTestId(DETAIL_DRAWER));
}

describe("row click opens the projectionDetail in a drawer", () => {
  test("shows the detail with tabs for the clicked row, in a wide panel", async () => {
    const { queries } = renderList();
    await openDetail();

    const drawer = screen.getByTestId(DETAIL_DRAWER);
    await waitFor(() => within(drawer).getByTestId("field-value-status"));
    expect(within(drawer).getByTestId("kumiko-screen-projection-detail-tabs")).toBeTruthy();
    const detailQuery = queries.find((q) => q.type === "offers:query:offer:detail");
    expect(detailQuery?.payload).toEqual({ offerId: "o1" });
    expect(drawer.getAttribute("style") ?? "").toContain("width: 1280px");
  });

  test("a header action is visible in the drawer and its write refreshes the detail", async () => {
    const { write } = renderList();
    await openDetail();
    const drawer = screen.getByTestId(DETAIL_DRAWER);
    await waitFor(() =>
      expect(within(drawer).getByTestId("field-value-status").textContent).toBe("draft"),
    );

    await userEvent.setup().click(within(drawer).getByTestId("render-edit-action-accept"));

    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(write.mock.calls[0]?.[0]).toBe("offers:write:offer:accept");
    await waitFor(() =>
      expect(within(drawer).getByTestId("field-value-status").textContent).toBe("accepted"),
    );
  });

  test("switching tabs does not touch the search params of the list behind", async () => {
    const { setSearchParams } = renderList();
    await openDetail();
    const drawer = screen.getByTestId(DETAIL_DRAWER);
    await waitFor(() => within(drawer).getByTestId("kumiko-screen-projection-detail-tabs"));

    await userEvent
      .setup()
      .click(within(drawer).getByTestId("kumiko-screen-projection-detail-tabs-positions"));

    await waitFor(() => within(drawer).getByText("Position A"));
    expect(setSearchParams).not.toHaveBeenCalled();
  });

  test("a related row action opens its actionForm in a second drawer; submit reloads the related tab", async () => {
    const { queries, write } = renderList();
    await openDetail();
    const detailDrawer = screen.getByTestId(DETAIL_DRAWER);
    await waitFor(() => within(detailDrawer).getByTestId("kumiko-screen-projection-detail-tabs"));
    const user = userEvent.setup();
    await user.click(
      within(detailDrawer).getByTestId("kumiko-screen-projection-detail-tabs-positions"),
    );
    await waitFor(() => within(detailDrawer).getByText("Position A"));
    const positionQueriesBefore = queries.filter(
      (q) => q.type === "offers:query:offer:positions",
    ).length;

    await user.click(within(detailDrawer).getByTestId("row-p1-action-add-note"));

    const noteDrawer = await waitFor(() => screen.getByTestId("toolbar-drawer-add-note"));
    expect(screen.getByTestId(DETAIL_DRAWER)).toBeTruthy();
    const labelInput = within(noteDrawer).getByTestId("field-label").querySelector("input");
    expect(labelInput?.value).toBe("Position A");
    const noteInput = within(noteDrawer).getByTestId("field-note").querySelector("input");
    if (noteInput === null) throw new Error("expected an <input> inside field-note");
    await user.type(noteInput, "hello");
    await user.click(within(noteDrawer).getByTestId("render-edit-submit"));

    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(write.mock.calls[0]?.[0]).toBe("offers:write:position:note");
    await waitFor(() => expect(screen.queryByTestId("toolbar-drawer-add-note")).toBeNull());
    await waitFor(() =>
      expect(
        queries.filter((q) => q.type === "offers:query:offer:positions").length,
      ).toBeGreaterThan(positionQueriesBefore),
    );
    expect(screen.getByTestId(DETAIL_DRAWER)).toBeTruthy();
  });

  test("closing the detail drawer reloads the list behind it", async () => {
    const { queries } = renderList();
    await openDetail();
    const drawer = screen.getByTestId(DETAIL_DRAWER);
    await waitFor(() => within(drawer).getByTestId("field-value-status"));
    const listQueriesBefore = queries.filter((q) => q.type === "offers:query:offer:list").length;

    await userEvent.setup().click(within(drawer).getByRole("button", { name: /close|schlie/i }));

    await waitFor(() => expect(screen.queryByTestId(DETAIL_DRAWER)).toBeNull());
    await waitFor(() =>
      expect(queries.filter((q) => q.type === "offers:query:offer:list").length).toBeGreaterThan(
        listQueriesBefore,
      ),
    );
  });
});
