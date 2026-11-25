// A projectionDetail opened from a list row in a `popup` drawer: headerless panel, flat detail header,
// and a drawer action with `back` that shows its form in place of the tab content.

import { describe, expect, mock, test } from "bun:test";
import type {
  ActionFormScreenDefinition,
  ProjectionDetailScreenDefinition,
  ProjectionListScreenDefinition,
  RowAction,
} from "@cosmicdrift/kumiko-framework/ui-types";
import userEvent from "@testing-library/user-event";
import type { FeatureSchema } from "../../index.ts";
import { DispatcherProvider, KumikoScreen, setLeaveConfirmer } from "../../index.ts";
import {
  createMockDispatcher,
  fireEvent,
  type MockQueryHandler,
  type MockWriteHandler,
  render,
  screen,
  waitFor,
  within,
} from "./test-utils.tsx";

const DRAWER = "toolbar-drawer-open-offer";
const FORM_DRAWER = "toolbar-drawer-edit-offer";

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
      width: "popup",
    },
  ],
};

const approve: RowAction = {
  kind: "writeHandler",
  id: "approve",
  label: "Approve",
  handler: "offers:write:offer:approve",
  payload: { map: { offerId: "id" } },
};

const offerDetail: ProjectionDetailScreenDefinition = {
  id: "offer-detail",
  type: "projectionDetail",
  query: "offers:query:offer:detail",
  idParam: "offerId",
  header: { title: "number", status: "status" },
  layout: {
    mode: "tabs",
    sections: [
      {
        id: "details",
        tabLabel: "Details",
        title: "Details",
        fields: [
          {
            field: "status",
            actions: [approve, { ...approve, id: "approve-iconed", icon: "check" }],
          },
        ],
      },
      { id: "notes", tabLabel: "Notes", title: "Notes", fields: ["number"] },
      {
        id: "footer-note",
        kind: "writeForm",
        placement: "footer",
        uploadEntity: "offer",
        fieldDefs: { memo: { type: "text" }, proof: { type: "file" } },
        fields: ["memo", "proof"],
        actions: [
          {
            kind: "writeHandler",
            id: "lost-all",
            label: "Lost all",
            style: "danger",
            handler: "offers:write:offer:lost",
            payload: { map: { offerId: "id" } },
          },
          {
            kind: "drawer",
            id: "lost-with-reason",
            label: "Lost with reason",
            screen: "offer-lost",
            params: { map: { offerId: "id" } },
            back: true,
          },
        ],
      },
    ],
  },
  actions: [
    {
      kind: "drawer",
      id: "edit-offer",
      label: "Edit offer",
      title: "Edit offer",
      subtitle: "Offer subtitle",
      screen: "offer-edit",
      back: true,
    },
  ],
};

const offerEdit: ActionFormScreenDefinition = {
  id: "offer-edit",
  type: "actionForm",
  handler: "offers:write:offer:edit",
  fields: { note: { type: "text", required: true } },
  layout: { sections: [{ fields: ["note"] }] },
};

const offerLost: ActionFormScreenDefinition = {
  id: "offer-lost",
  type: "actionForm",
  handler: "offers:write:offer:lost-with-reason",
  fields: {
    offerId: { type: "text" },
    memo: { type: "text" },
    reason: { type: "text", required: true },
  },
  layout: {
    sections: [
      {
        fields: [{ field: "offerId", visible: false }, { field: "memo", visible: false }, "reason"],
      },
    ],
  },
};

const schema: FeatureSchema = {
  featureName: "offers",
  entities: {},
  screens: [offerList, offerDetail, offerEdit, offerLost],
};

function renderList(): {
  readonly write: ReturnType<typeof mock<MockWriteHandler>>;
  readonly detailLoads: () => number;
} {
  let detailLoads = 0;
  const query: MockQueryHandler = async (type: string) => {
    if (type === "offers:query:offer:list") {
      return {
        isSuccess: true,
        data: { rows: [{ id: "o1", title: "Offer 1" }], nextCursor: null },
      };
    }
    if (type === "offers:query:offer:detail") {
      detailLoads += 1;
      return { isSuccess: true, data: { id: "o1", number: "A-100", status: "draft" } };
    }
    return { isSuccess: true, data: { rows: [], nextCursor: null } };
  };
  const write = mock<MockWriteHandler>(async () => ({ isSuccess: true, data: {} }));
  render(
    <DispatcherProvider dispatcher={createMockDispatcher({ query, write })}>
      <KumikoScreen schema={schema} qn="offers:screen:offer-list" />
    </DispatcherProvider>,
  );
  return { write, detailLoads: () => detailLoads };
}

async function openDetail(): Promise<HTMLElement> {
  await waitFor(() => screen.getByText("Offer 1"));
  await userEvent.setup().click(screen.getByText("Offer 1"));
  const drawer = await waitFor(() => screen.getByTestId(DRAWER));
  await waitFor(() => within(drawer).getByTestId("kumiko-screen-projection-detail-flat-header"));
  return drawer;
}

async function openForm(drawer: HTMLElement): Promise<void> {
  await userEvent.setup().click(within(drawer).getByTestId("render-edit-action-edit-offer"));
  await waitFor(() => within(drawer).getByTestId(FORM_DRAWER));
}

async function typeNote(drawer: HTMLElement, text: string): Promise<void> {
  const input = await waitFor(() => {
    const el = within(drawer).getByTestId(`${FORM_DRAWER}-body`).querySelector("input");
    if (el === null) throw new Error("expected the form input");
    return el;
  });
  await userEvent.setup().type(input, text);
}

describe("popup drawer", () => {
  test("keeps a 24px margin on every side, has no width cap and no title bar", async () => {
    renderList();
    const drawer = await openDetail();
    expect(drawer.className).toContain("inset-6");
    expect(drawer.className).toContain("max-w-none");
    expect(drawer.className).toContain("rounded-xl");
    expect(drawer.className).toContain("bg-card");
    expect(screen.queryByTestId(`${DRAWER}-header`)).toBeNull();
    const title = within(drawer).getByText("offers:action:open");
    expect(title.className).toContain("sr-only");
  });

  test("the × button closes the popup", async () => {
    renderList();
    await openDetail();
    await userEvent.setup().click(screen.getByTestId(`${DRAWER}-close`));
    await waitFor(() => expect(screen.queryByTestId(DRAWER)).toBeNull());
  });

  test("the detail header is flat in the drawer: no card around title and metrics", async () => {
    renderList();
    const drawer = await openDetail();
    const header = within(drawer).getByTestId("kumiko-screen-projection-detail-flat-header");
    const title = within(header).getByTestId("kumiko-screen-projection-detail-title");
    expect(title.textContent).toBe("A-100");
    expect(title.className).toContain("text-[22px]");
    expect(header.querySelector("[data-slot='card']")).toBeNull();
  });

  test("a footer button without a declared icon shows none", async () => {
    renderList();
    const drawer = await openDetail();
    const lostAll = await waitFor(() => within(drawer).getByTestId("render-edit-action-lost-all"));
    expect(lostAll.querySelector("svg")).toBeNull();
  });

  test("a button next to a value shows an icon only when the author declared one", async () => {
    renderList();
    const drawer = await openDetail();
    const plain = await waitFor(() => within(drawer).getByTestId("render-edit-action-approve"));
    expect(plain.querySelector("svg")).toBeNull();
    const iconed = within(drawer).getByTestId("render-edit-action-approve-iconed");
    expect(iconed.querySelector("svg")).not.toBeNull();
  });

  test("the form around the tab content adds no gutter of its own", async () => {
    renderList();
    const drawer = await openDetail();
    const scroll = await waitFor(() => within(drawer).getByTestId("render-edit-form-scroll"));
    expect(scroll.className).not.toContain("px-6");
  });

  test("a file field in the footer gets a fixed column instead of sharing the note's width", async () => {
    renderList();
    const drawer = await openDetail();
    const pick = await waitFor(() => {
      const el = drawer.querySelector("[data-slot='file-upload-pick']");
      if (el === null) throw new Error("expected the file picker");
      return el;
    });
    expect(pick.closest("[class*='sm:w-[260px]']")).not.toBeNull();
    const memo = drawer.querySelector("input[type='text'], textarea");
    expect(memo?.closest("[class*='sm:w-[260px]']") ?? null).toBeNull();
  });
});

describe("in-place edit inside the popup", () => {
  test("a back action shows its form in the same popup, not in a second dialog", async () => {
    renderList();
    const drawer = await openDetail();
    await openForm(drawer);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(within(drawer).getByTestId(`${FORM_DRAWER}-back`)).toBeTruthy();
    expect(within(drawer).getByTestId(`${FORM_DRAWER}-subtitle`).textContent).toBe(
      "Offer subtitle",
    );
  });

  test("back without input returns to the tabs without asking", async () => {
    renderList();
    const drawer = await openDetail();
    await openForm(drawer);
    await userEvent.setup().click(within(drawer).getByTestId(`${FORM_DRAWER}-back`));
    await waitFor(() => expect(within(drawer).queryByTestId(FORM_DRAWER)).toBeNull());
    expect(screen.queryByTestId("drawer-discard-dialog")).toBeNull();
    within(drawer).getByTestId("kumiko-screen-projection-detail-tabs");
  });

  test("Escape closes only the form; with input it asks first", async () => {
    renderList();
    const drawer = await openDetail();
    await openForm(drawer);
    await typeNote(drawer, "draft");
    await userEvent.setup().keyboard("{Escape}");
    await waitFor(() => screen.getByTestId("drawer-discard-dialog"));
    expect(screen.getByTestId(DRAWER)).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: /discard|verwerfen/i }));
    await waitFor(() => expect(within(drawer).queryByTestId(FORM_DRAWER)).toBeNull());
    expect(screen.getByTestId(DRAWER)).toBeTruthy();
  });

  test("a tab click asks about unsent input, then closes the form and switches the tab", async () => {
    renderList();
    const drawer = await openDetail();
    await openForm(drawer);
    await typeNote(drawer, "draft");
    await userEvent
      .setup()
      .click(within(drawer).getByTestId("kumiko-screen-projection-detail-tabs-notes"));
    await waitFor(() => screen.getByTestId("drawer-discard-dialog"));
    await userEvent.setup().click(screen.getByRole("button", { name: /discard|verwerfen/i }));
    await waitFor(() => expect(within(drawer).queryByTestId(FORM_DRAWER)).toBeNull());
  });

  test("an unsent footer note survives opening and closing the form", async () => {
    renderList();
    const drawer = await openDetail();
    const user = userEvent.setup();
    await openForm(drawer);
    // The footer form is hidden while the form shows, but stays mounted and keeps its value.
    const memo = within(drawer).getByTestId("field-memo").querySelector("input");
    if (memo === null) throw new Error("expected the footer input");
    fireEvent.change(memo, { target: { value: "keep me" } });
    await user.click(within(drawer).getByTestId(`${FORM_DRAWER}-back`));
    await waitFor(() => expect(within(drawer).queryByTestId(FORM_DRAWER)).toBeNull());
    const after = within(drawer).getByTestId("field-memo").querySelector("input");
    expect(after?.value).toBe("keep me");
  });

  test("a tab switch keeps an unsent footer note and asks nothing", async () => {
    const confirmer = mock(() => {});
    const unsetConfirmer = setLeaveConfirmer(confirmer);
    renderList();
    const drawer = await openDetail();
    const user = userEvent.setup();
    const footer = await waitFor(() => within(drawer).getByTestId("field-memo"));
    const memo = footer.querySelector("input");
    if (memo === null) throw new Error("expected the footer input");
    fireEvent.change(memo, { target: { value: "keep me" } });
    const notesTab = "kumiko-screen-projection-detail-tabs-notes";
    await user.click(within(drawer).getByTestId(notesTab));
    unsetConfirmer();
    expect(confirmer).not.toHaveBeenCalled();
    expect(within(drawer).getByTestId(notesTab).getAttribute("aria-selected")).toBe("true");
    expect(within(drawer).getByTestId("field-memo").querySelector("input")?.value).toBe("keep me");
  });

  test("a form opened from the footer carries the unsent footer note without asking to discard it", async () => {
    const { write } = renderList();
    const drawer = await openDetail();
    const user = userEvent.setup();
    const footer = await waitFor(() => within(drawer).getByTestId("field-memo"));
    const memo = footer.querySelector("input");
    if (memo === null) throw new Error("expected the footer input");
    fireEvent.change(memo, { target: { value: "keep me" } });
    await user.click(within(drawer).getByTestId("render-edit-action-lost-with-reason"));
    const form = await waitFor(() =>
      within(drawer).getByTestId("toolbar-drawer-lost-with-reason-body"),
    );
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    const reason = await waitFor(() => {
      const el = within(form).getByTestId("field-reason").querySelector("input");
      if (el === null) throw new Error("expected the reason input");
      return el;
    });
    await user.type(reason, "price");
    await user.click(form.querySelector("button[type='submit']") as HTMLElement);
    await waitFor(() =>
      expect(write).toHaveBeenCalledWith(
        "offers:write:offer:lost-with-reason",
        expect.objectContaining({ offerId: "o1", memo: "keep me", reason: "price" }),
        expect.anything(),
      ),
    );
  });

  test("saving closes the form and reloads the detail", async () => {
    const { write, detailLoads } = renderList();
    const drawer = await openDetail();
    await openForm(drawer);
    const loadsBefore = detailLoads();
    await typeNote(drawer, "done");
    await userEvent
      .setup()
      .click(
        within(drawer)
          .getByTestId(`${FORM_DRAWER}-body`)
          .querySelector("button[type='submit']") as HTMLElement,
      );
    await waitFor(() => expect(write).toHaveBeenCalled());
    await waitFor(() => expect(within(drawer).queryByTestId(FORM_DRAWER)).toBeNull());
    await waitFor(() => expect(detailLoads()).toBeGreaterThan(loadsBefore));
  });
});
