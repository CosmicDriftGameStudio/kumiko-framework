import { describe, expect, test } from "bun:test";
import type {
  ActionFormScreenDefinition,
  EntityDefinition,
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import userEvent from "@testing-library/user-event";
import type { Dispatcher } from "../../headless/index.ts";
import type { FeatureSchema } from "../../index.ts";
import { AppFeaturesProvider, DispatcherProvider, KumikoScreen } from "../../index.ts";
import { createMockDispatcher, render, screen, waitFor, within } from "./test-utils.tsx";

const taskEntity = {
  fields: {
    title: { type: "text", required: true },
    status: { type: "text" },
  },
} as unknown as EntityDefinition;

const editScreen: EntityEditScreenDefinition = {
  id: "task-edit",
  type: "entityEdit",
  entity: "task",
  layout: { sections: [{ fields: ["title"] }] },
};

const noteForm: ActionFormScreenDefinition = {
  id: "task-note",
  type: "actionForm",
  handler: "tasks:write:task:note",
  fields: { note: { type: "text", required: true } },
  layout: { sections: [{ fields: ["note"] }] },
};

type WriteCall = { readonly type: string; readonly payload: unknown };

function makeDispatcher(writeCalls: WriteCall[] = []): Dispatcher {
  return createMockDispatcher({
    query: async () => ({
      isSuccess: true,
      data: {
        rows: [
          { id: "r1", title: "Alpha", status: "lost" },
          { id: "r2", title: "Beta", status: "open" },
        ],
        nextCursor: null,
      },
    }),
    write: async (type: string, payload: unknown) => {
      writeCalls.push({ type, payload });
      return { isSuccess: true, data: {} };
    },
  });
}

async function renderList(
  list: Partial<EntityListScreenDefinition>,
  dispatcher: Dispatcher = makeDispatcher(),
): Promise<ReturnType<typeof userEvent.setup>> {
  const listScreen: EntityListScreenDefinition = {
    id: "task-list",
    type: "entityList",
    entity: "task",
    columns: ["title"],
    ...list,
  };
  const schema: FeatureSchema = {
    featureName: "tasks",
    entities: { task: taskEntity },
    screens: [listScreen, editScreen, noteForm],
  };
  const user = userEvent.setup();
  render(
    <AppFeaturesProvider features={[schema]}>
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="tasks:screen:task-list" />
      </DispatcherProvider>
    </AppFeaturesProvider>,
  );
  await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());
  return user;
}

describe("entityList allowEdit", () => {
  test("the list offers the automatic Edit row action by default", async () => {
    await renderList({});

    expect(screen.queryByTestId("row-r1-action-edit")).not.toBeNull();
  });

  test("allowEdit: false drops the automatic Edit action but keeps declared actions", async () => {
    await renderList({
      allowEdit: false,
      rowActions: [
        {
          kind: "writeHandler",
          id: "mark",
          label: "Mark",
          handler: "tasks:write:task:mark",
          display: "button",
        },
      ],
    });

    expect(screen.queryByTestId("row-r1-action-edit")).toBeNull();
    expect(screen.queryByTestId("row-r1-action-mark")).not.toBeNull();
  });
});

describe("row action active", () => {
  const lostWhen = { field: "status", eq: "lost" } as const;
  const markAction = {
    kind: "writeHandler",
    id: "mark",
    label: "Mark",
    handler: "tasks:write:task:mark",
    display: "button",
  } as const;

  test("a button is pressed only on the rows matching the condition", async () => {
    await renderList({
      allowEdit: false,
      rowActions: [{ ...markAction, active: { when: lostWhen } }],
    });

    const lost = screen.getByTestId("row-r1-action-mark");
    const open = screen.getByTestId("row-r2-action-mark");
    expect(lost.getAttribute("aria-pressed")).toBe("true");
    expect(open.getAttribute("aria-pressed")).toBe("false");
    expect(lost.classList.contains("bg-accent")).toBe(true);
    expect(open.classList.contains("bg-accent")).toBe(false);
  });

  test("style danger fills the pressed button with the destructive colour", async () => {
    await renderList({
      allowEdit: false,
      rowActions: [{ ...markAction, active: { when: lostWhen, style: "danger" } }],
    });

    const lost = screen.getByTestId("row-r1-action-mark");
    expect(lost.classList.contains("bg-destructive")).toBe(true);
    expect(lost.classList.contains("text-destructive-foreground")).toBe(true);
  });

  test("an action without active declares no aria-pressed", async () => {
    await renderList({ allowEdit: false, rowActions: [markAction] });

    expect(screen.getByTestId("row-r1-action-mark").hasAttribute("aria-pressed")).toBe(false);
  });

  test("a pressed and disabled button keeps its colour and does not write", async () => {
    const writeCalls: WriteCall[] = [];
    const user = await renderList(
      {
        allowEdit: false,
        rowActions: [
          {
            ...markAction,
            active: { when: lostWhen, style: "danger" },
            disabled: lostWhen,
          },
        ],
      },
      makeDispatcher(writeCalls),
    );

    const lost = screen.getByTestId("row-r1-action-mark") as HTMLButtonElement;
    expect(lost.disabled).toBe(true);
    expect(lost.classList.contains("bg-destructive")).toBe(true);
    expect(lost.className).not.toContain("disabled:opacity-50");
    await user.click(lost);
    expect(writeCalls).toEqual([]);
  });
});

describe("row action drawer back", () => {
  const openNote = {
    kind: "drawer",
    id: "add-note",
    label: "actions.addNote",
    screen: "task-note",
  } as const;
  const DRAWER_TEST_ID = "toolbar-drawer-add-note";

  test("back shows an arrow left of the title instead of the close cross and closes the drawer", async () => {
    const user = await renderList({
      allowEdit: false,
      rowActions: [{ ...openNote, back: true as const }],
    });
    await user.click(screen.getByTestId("row-r1-action-add-note"));
    await waitFor(() => screen.getByTestId(DRAWER_TEST_ID));

    const header = within(screen.getByTestId(`${DRAWER_TEST_ID}-header`));
    expect(header.queryByLabelText("Close")).toBeNull();
    const back = header.getByLabelText("Back");
    const title = header.getByText("actions.addNote");
    expect(back.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(back);

    await waitFor(() => expect(screen.queryByTestId(DRAWER_TEST_ID)).toBeNull());
  });

  test("without back the header keeps the close cross and no back arrow", async () => {
    const user = await renderList({ allowEdit: false, rowActions: [openNote] });
    await user.click(screen.getByTestId("row-r1-action-add-note"));
    await waitFor(() => screen.getByTestId(DRAWER_TEST_ID));

    const header = within(screen.getByTestId(`${DRAWER_TEST_ID}-header`));
    expect(header.queryByLabelText("Close")).not.toBeNull();
    expect(header.queryByLabelText("Back")).toBeNull();
  });
});
