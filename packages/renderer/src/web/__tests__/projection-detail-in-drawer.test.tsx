// A list row opens its projectionDetail (tabs, related tab, header actions) in a wide drawer.

import { describe, expect, mock, test } from "bun:test";
import type {
  ActionFormScreenDefinition,
  ProjectionDetailScreenDefinition,
  ProjectionListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import userEvent from "@testing-library/user-event";
import type { FeatureSchema, NavApi } from "../../index.ts";
import {
  createStaticLocaleResolver,
  DispatcherProvider,
  KumikoScreen,
  kumikoDefaultTranslations,
  LocaleProvider,
  NavProvider,
} from "../../index.ts";
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

function renderList(
  schemaUnderTest: FeatureSchema = schema,
  translations?: Readonly<Record<string, Readonly<Record<string, string>>>>,
): Harness {
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
  const screenTree = (
    <NavProvider value={nav}>
      <DispatcherProvider dispatcher={createMockDispatcher({ query, write })}>
        <KumikoScreen schema={schemaUnderTest} qn="offers:screen:offer-list" />
      </DispatcherProvider>
    </NavProvider>
  );
  render(
    translations === undefined ? (
      screenTree
    ) : (
      <LocaleProvider
        resolver={createStaticLocaleResolver()}
        fallbackBundles={[kumikoDefaultTranslations, translations]}
      >
        {screenTree}
      </LocaleProvider>
    ),
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
    screen.getByTestId(DETAIL_DRAWER);
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
    within(drawer).getByTestId("kumiko-screen-projection-detail-tabs");
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
    screen.getByTestId(DETAIL_DRAWER);
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
    screen.getByTestId(DETAIL_DRAWER);
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

function renderWith(
  schemaUnderTest: FeatureSchema,
  detail: Readonly<Record<string, unknown>>,
  write?: ReturnType<typeof mock<MockWriteHandler>>,
  translations?: Readonly<Record<string, Readonly<Record<string, string>>>>,
): void {
  const query: MockQueryHandler = async (type: string) =>
    type === "offers:query:offer:list"
      ? {
          isSuccess: true,
          data: { rows: [{ id: "o1", title: "Offer 1", quoteNumber: "A-17" }], nextCursor: null },
        }
      : { isSuccess: true, data: { id: "o1", ...detail } };
  const screenTree = (
    <DispatcherProvider dispatcher={createMockDispatcher({ query, ...(write && { write }) })}>
      <KumikoScreen schema={schemaUnderTest} qn="offers:screen:offer-list" />
    </DispatcherProvider>
  );
  render(
    translations === undefined ? (
      screenTree
    ) : (
      <LocaleProvider
        resolver={createStaticLocaleResolver()}
        fallbackBundles={[kumikoDefaultTranslations, translations]}
      >
        {screenTree}
      </LocaleProvider>
    ),
  );
}

function withDetail(
  extra: Partial<ProjectionDetailScreenDefinition>,
  listExtra: Partial<(typeof offerList.rowActions & object)[number]> = {},
): FeatureSchema {
  return {
    ...schema,
    screens: [
      {
        ...offerList,
        rowActions: [{ ...offerList.rowActions?.[0], ...listExtra } as never],
      },
      { ...offerDetail, layout: { mode: "single", sections: [] }, ...extra },
      positionNote,
    ],
  };
}

describe("detail drawer layout and header", () => {
  const footerSchema = withDetail({
    layout: {
      mode: "single",
      sections: [
        { id: "details", title: "Details", fields: ["status"] },
        {
          kind: "writeForm",
          placement: "footer",
          fieldDefs: { message: { type: "text" } },
          fields: ["message"],
          actions: [
            { kind: "writeHandler", id: "send", label: "Send", handler: "offers:write:offer:send" },
          ],
        },
      ],
    },
  });

  test("only the record content scrolls; the footer is a pinned sibling below it", async () => {
    renderWith(footerSchema, { status: "draft" });
    await openDetail();
    const drawer = screen.getByTestId(DETAIL_DRAWER);
    const footer = await waitFor(() => within(drawer).getByTestId("write-form-footer"));
    const scroller = within(drawer).getByTestId("field-value-status").closest(".overflow-y-auto");
    expect(scroller).not.toBeNull();
    expect(scroller?.contains(footer)).toBe(false);
    const pinned = footer.parentElement;
    expect(pinned?.className).toContain("shrink-0");
    expect(pinned?.className).not.toContain("border-t");
    expect(pinned?.previousElementSibling?.className).toContain("overflow-y-auto");
    expect(pinned?.previousElementSibling?.contains(scroller)).toBe(true);
  });

  test("the drawer header shows the primary and the secondary status badge", async () => {
    renderWith(
      withDetail({ header: { title: "status", status: "status", secondaryStatus: "stage" } }),
      { status: "draft", stage: "overdue" },
    );
    await openDetail();
    const drawer = screen.getByTestId(DETAIL_DRAWER);
    await waitFor(() =>
      within(drawer).getByTestId("kumiko-screen-projection-detail-secondary-status"),
    );
    expect(
      within(drawer).getByTestId("kumiko-screen-projection-detail-secondary-status").textContent,
    ).toBe("overdue");
    within(drawer).getByTestId("kumiko-screen-projection-detail-status");
  });

  test("title and subtitle resolve {name} params picked from the row", async () => {
    renderWith(
      withDetail(
        { layout: { mode: "single", sections: [{ id: "d", title: "D", fields: ["status"] }] } },
        {
          title: "offers:drawer:title",
          subtitle: "offers:drawer:subtitle",
          params: { pick: ["quoteNumber", "title"] },
        },
      ),
      { status: "draft" },
      undefined,
      {
        en: {
          "offers:drawer:title": "Quote {quoteNumber}",
          "offers:drawer:subtitle": "For {title}",
        },
      },
    );
    await openDetail();
    expect(screen.getByTestId(`${DETAIL_DRAWER}-header`).textContent).toContain("Quote A-17");
    expect(screen.getByTestId(`${DETAIL_DRAWER}-subtitle`).textContent).toBe("For Offer 1");
  });
});

describe("headingFields feed the drawer heading only", () => {
  const headingSchema: FeatureSchema = {
    ...schema,
    screens: [
      offerList,
      {
        ...offerDetail,
        layout: {
          mode: "single",
          sections: [
            {
              id: "positions",
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
                  title: "offers:drawer:title",
                  subtitle: "offers:drawer:subtitle",
                  headingFields: ["label", "gone"],
                },
              ],
            },
          ],
        },
      },
      {
        ...positionNote,
        fields: { note: { type: "text", required: true } },
        layout: { sections: [{ fields: ["note"] }] },
      },
    ],
  };

  test("the subtitle shows the row values, a missing one as empty text, and the payload stays clean", async () => {
    const { write } = renderList(headingSchema, {
      en: {
        "offers:drawer:title": "Note",
        "offers:drawer:subtitle": "{label} / {gone}",
      },
    });
    await openDetail();
    const detailDrawer = screen.getByTestId(DETAIL_DRAWER);
    const user = userEvent.setup();
    await user.click(
      await waitFor(() => within(detailDrawer).getByTestId("row-p1-action-add-note")),
    );

    const noteDrawer = await waitFor(() => screen.getByTestId("toolbar-drawer-add-note"));
    expect(within(noteDrawer).getByTestId("toolbar-drawer-add-note-subtitle").textContent).toBe(
      "Position A / ",
    );
    const noteInput = within(noteDrawer).getByTestId("field-note").querySelector("input");
    if (noteInput === null) throw new Error("expected an <input> inside field-note");
    await user.type(noteInput, "hello");
    await user.click(within(noteDrawer).getByTestId("render-edit-submit"));

    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(write.mock.calls[0]?.[1]).toEqual({ note: "hello" });
  });
});

describe("field actions in a fields section", () => {
  const fieldActionSchema = (statusValue: unknown): [FeatureSchema, unknown] => [
    withDetail({
      layout: {
        mode: "single",
        sections: [
          {
            id: "d",
            title: "D",
            fields: [
              {
                field: "status",
                actions: [
                  {
                    kind: "writeHandler",
                    id: "regenerate",
                    label: "Regenerate",
                    handler: "offers:write:offer:regenerate",
                    display: "button",
                  },
                  {
                    kind: "drawer",
                    id: "annotate",
                    label: "Annotate",
                    screen: "position-note",
                    display: "button",
                    params: { pick: ["status"] },
                  },
                ],
              },
            ],
          },
        ],
      },
    }),
    statusValue,
  ];

  test("buttons sit beside the value and a write action runs against the record", async () => {
    const [schemaUnderTest] = fieldActionSchema("draft");
    const write = mock<MockWriteHandler>(async () => ({ isSuccess: true, data: {} }));
    renderWith(schemaUnderTest, { status: "draft" }, write);
    await openDetail();
    const drawer = screen.getByTestId(DETAIL_DRAWER);
    const holder = await waitFor(() => within(drawer).getByTestId("field-status"));
    within(holder).getByTestId("render-edit-action-annotate");
    await userEvent.setup().click(within(holder).getByTestId("render-edit-action-regenerate"));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(write.mock.calls[0]?.[0]).toBe("offers:write:offer:regenerate");
  });

  test("buttons render when the value is empty", async () => {
    const [schemaUnderTest] = fieldActionSchema("");
    renderWith(schemaUnderTest, { status: null });
    await openDetail();
    const drawer = screen.getByTestId(DETAIL_DRAWER);
    const holder = await waitFor(() => within(drawer).getByTestId("field-status"));
    within(holder).getByTestId("render-edit-action-regenerate");
  });

  test("a drawer field action opens its screen in a second drawer with the record prefill", async () => {
    const [schemaUnderTest] = fieldActionSchema("draft");
    renderWith(schemaUnderTest, { status: "draft" });
    await openDetail();
    const drawer = screen.getByTestId(DETAIL_DRAWER);
    const holder = await waitFor(() => within(drawer).getByTestId("field-status"));
    await userEvent.setup().click(within(holder).getByTestId("render-edit-action-annotate"));
    await waitFor(() => screen.getByTestId("toolbar-drawer-annotate"));
    screen.getByTestId(DETAIL_DRAWER);
  });
});

describe("actionForm cancelInDrawer", () => {
  const cancelSchema = (cancelInDrawer: boolean): FeatureSchema => ({
    ...schema,
    screens: [
      offerList,
      offerDetail,
      { ...positionNote, ...(cancelInDrawer && { cancelInDrawer: true as const }) },
    ],
  });

  async function openNote(schemaUnderTest: FeatureSchema): Promise<HTMLElement> {
    const query: MockQueryHandler = async (type: string) =>
      type === "offers:query:offer:list"
        ? { isSuccess: true, data: { rows: [{ id: "o1", title: "Offer 1" }], nextCursor: null } }
        : type === "offers:query:offer:detail"
          ? { isSuccess: true, data: { id: "o1", status: "draft" } }
          : {
              isSuccess: true,
              data: { rows: [{ id: "p1", label: "Position A" }], nextCursor: null },
            };
    render(
      <DispatcherProvider dispatcher={createMockDispatcher({ query })}>
        <KumikoScreen schema={schemaUnderTest} qn="offers:screen:offer-list" />
      </DispatcherProvider>,
    );
    await openDetail();
    const detailDrawer = screen.getByTestId(DETAIL_DRAWER);
    const user = userEvent.setup();
    await waitFor(() => within(detailDrawer).getByTestId("kumiko-screen-projection-detail-tabs"));
    await user.click(
      within(detailDrawer).getByTestId("kumiko-screen-projection-detail-tabs-positions"),
    );
    await waitFor(() => within(detailDrawer).getByText("Position A"));
    await user.click(within(detailDrawer).getByTestId("row-p1-action-add-note"));
    return waitFor(() => screen.getByTestId("toolbar-drawer-add-note"));
  }

  test("without the flag a drawer form has no Cancel button", async () => {
    const noteDrawer = await openNote(cancelSchema(false));
    expect(within(noteDrawer).queryByTestId("render-edit-cancel")).toBeNull();
  });

  test("Cancel closes the pristine drawer, labelled Cancel", async () => {
    const noteDrawer = await openNote(cancelSchema(true));
    const cancel = within(noteDrawer).getByTestId("render-edit-cancel");
    expect(cancel.textContent).toMatch(/cancel|abbrech/i);
    await userEvent.setup().click(cancel);
    await waitFor(() => expect(screen.queryByTestId("toolbar-drawer-add-note")).toBeNull());
  });

  test("Cancel asks before discarding unsent input", async () => {
    const noteDrawer = await openNote(cancelSchema(true));
    const user = userEvent.setup();
    const input = within(noteDrawer).getByTestId("field-note").querySelector("input");
    if (input === null) throw new Error("expected an <input> inside field-note");
    await user.type(input, "unsent");
    await user.click(within(noteDrawer).getByTestId("render-edit-cancel"));
    await waitFor(() => screen.getByTestId("drawer-discard-dialog"));
    screen.getByTestId("toolbar-drawer-add-note");
  });
});
