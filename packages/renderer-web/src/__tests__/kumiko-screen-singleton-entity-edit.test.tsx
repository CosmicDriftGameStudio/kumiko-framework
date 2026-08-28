import { describe, expect, mock, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import type { FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import {
  DispatcherProvider,
  KumikoScreen,
  kumikoDefaultTranslations,
} from "@cosmicdrift/kumiko-renderer";
import { createMockDispatcher, fireEvent, render, screen, waitFor } from "./test-utils";

// Split out of kumiko-screen.test.tsx (#2495): the create->update submit
// test below fires fireEvent.change immediately followed by fireEvent.click
// right after an async data-load settles — exactly the pattern that trips
// the #457 shared single-process happy-dom event-delegation corruption once
// enough prior DOM test files have mounted/unmounted in the same process.
// Isolating just this describe block (not the whole 2600+ line parent file)
// keeps the coverage/dom blast radius small while still using the codebase's
// established remedy (bunfig.ci-dom.toml, pathIgnorePatterns in
// bunfig.dom.toml) for that bug class.

const taskEntity = {
  fields: {
    title: { type: "text", required: true },
    count: { type: "number" },
    done: { type: "boolean" },
  },
} as unknown as EntityDefinition;

function makeDispatcher(overrides: Partial<Dispatcher> = {}): Dispatcher {
  const base = createMockDispatcher({
    query: (async () => ({
      isSuccess: true,
      data: { rows: [], nextCursor: null },
    })) as unknown as Dispatcher["query"],
  });
  return { ...base, ...overrides };
}

describe("KumikoScreen: singleton entityEdit", () => {
  const singletonEdit: EntityEditScreenDefinition = {
    id: "task-edit",
    type: "entityEdit",
    entity: "task",
    singleton: true,
    layout: { sections: [{ title: "Basics", fields: ["title"] }] },
  };
  const singletonSchema: FeatureSchema = {
    featureName: "tasks",
    entities: { task: taskEntity },
    screens: [singletonEdit],
  };

  test("kein vorhandener Record → rendert leeres Create-Form", async () => {
    const queryCalls: { type: string; payload: unknown }[] = [];
    const dispatcher = makeDispatcher({
      query: (async (type: string, payload: unknown) => {
        queryCalls.push({ type, payload });
        return { isSuccess: true, data: { rows: [], nextCursor: null } };
      }) as unknown as Dispatcher["query"],
    });
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={singletonSchema} qn="tasks:screen:task-edit" />
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());
    expect(screen.getByTestId("render-edit-form")).toBeTruthy();
    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    expect(titleInput.value).toBe("");
    expect(queryCalls).toEqual([{ type: "tasks:query:task:list", payload: { limit: 1 } }]);
  });

  test("vorhandener Record → lädt ihn (Update-Form, prefilled) statt Create", async () => {
    const queryCalls: { type: string; payload: unknown }[] = [];
    const dispatcher = makeDispatcher({
      query: (async (type: string, payload: unknown) => {
        queryCalls.push({ type, payload });
        if (type.endsWith(":list")) {
          return {
            isSuccess: true,
            data: { rows: [{ id: "task-1", title: "loaded-title" }], nextCursor: null },
          };
        }
        return {
          isSuccess: true,
          data: { id: "task-1", version: 1, title: "loaded-title", count: 0, done: false },
        };
      }) as unknown as Dispatcher["query"],
    });
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={singletonSchema} qn="tasks:screen:task-edit" />
      </DispatcherProvider>,
    );
    // Two sequential loading cycles (list, then detail once the singleton
    // wrapper hands off to EntityEditUpdateBody) — default waitFor timeout
    // can be too tight under CI's shared-process test load.
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull(), {
      timeout: 5000,
    });
    expect(screen.getByTestId("render-edit-form")).toBeTruthy();
    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    expect(titleInput.value).toBe("loaded-title");
    // Anchor: the id resolved from list(limit:1) reaches the detail query —
    // otherwise the form would render empty/create-mode instead of loading it.
    expect(queryCalls).toContainEqual({
      type: "tasks:query:task:detail",
      payload: { id: "task-1" },
    });
  });

  test("allowCreate:false + leere Tabelle → Fehler-Banner statt Create-Form", async () => {
    const disabledSchema: FeatureSchema = {
      featureName: "tasks",
      entities: { task: taskEntity },
      screens: [{ ...singletonEdit, allowCreate: false }],
    };
    const dispatcher = makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { rows: [], nextCursor: null },
      })) as unknown as Dispatcher["query"],
    });
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={disabledSchema} qn="tasks:screen:task-edit" />
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());
    expect(screen.getByTestId("kumiko-screen-create-disabled")).toBeTruthy();
    expect(screen.queryByTestId("render-edit-form")).toBeNull();
  });

  // The singleton wrapper fires its own list(limit:1) query up front — a
  // screen whose `list` handler has stricter access.roles than its `edit`
  // handler used to render fine (no query ran before this feature) and now
  // flips to an error banner instead. No test caught that regression.
  test("list-Query schlägt fehl → Fehler-Banner statt Create-Form", async () => {
    const dispatcher = makeDispatcher({
      query: (async () => ({
        isSuccess: false,
        error: {
          code: "access_denied",
          httpStatus: 403,
          i18nKey: "errors.access.denied",
          message: "",
        },
      })) as unknown as Dispatcher["query"],
    });
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={singletonSchema} qn="tasks:screen:task-edit" />
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());
    const bannerText = screen.getByTestId("kumiko-screen-error").textContent;
    expect(bannerText).toBe(kumikoDefaultTranslations["en"]?.["errors.access.denied"] ?? "");
    expect(screen.queryByTestId("render-edit-form")).toBeNull();
  });

  // kumiko-screen#1944: EntityEditSingletonBody runs without a wrapping
  // entityList screen, so the create-body's default "navigate back to the
  // list" success handler is a silent no-op — a successful create used to
  // leave the form stuck on the just-submitted create values, and a second
  // submit created a duplicate record ("exactly one record per tenant"
  // broken). Create on an empty table must now switch straight to the
  // update form of the newly created record.
  test("erfolgreicher Create bei leerer Tabelle wechselt in Update-Form des neuen Records (kein zweiter Create möglich)", async () => {
    let created = false;
    const write = mock(async (type: string) => {
      if (type === "tasks:write:task:create") {
        created = true;
        return { isSuccess: true, data: { id: "task-1" } };
      }
      return { isSuccess: true, data: {} };
    });
    const query = mock(async (type: string) => {
      if (type === "tasks:query:task:list") {
        return created
          ? { isSuccess: true, data: { rows: [{ id: "task-1", title: "Created title" }] } }
          : { isSuccess: true, data: { rows: [], nextCursor: null } };
      }
      if (type === "tasks:query:task:detail") {
        return {
          isSuccess: true,
          data: { id: "task-1", version: 1, title: "Created title", count: 0, done: false },
        };
      }
      return { isSuccess: true, data: { rows: [], nextCursor: null } };
    });
    const dispatcher = makeDispatcher({
      write: write as unknown as Dispatcher["write"],
      query: query as unknown as Dispatcher["query"],
    });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={singletonSchema} qn="tasks:screen:task-edit" />
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());

    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Created title" } });
    fireEvent.click(screen.getByTestId("render-edit-submit"));

    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    // The singleton wrapper refetches its list(limit:1) query after the
    // create succeeds, sees the new row, and switches from the create body
    // to the update body — which loads the record via its own detail
    // query, landing on the same title through a different data path.
    await waitFor(() => {
      const input = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
      expect(input.value).toBe("Created title");
    });
    expect(query).toHaveBeenCalledWith(
      "tasks:query:task:detail",
      { id: "task-1" },
      expect.anything(),
    );

    // A second submit on the (now update-mode) form must dispatch an
    // update, never a second create.
    fireEvent.change(screen.getByTestId("field-title").querySelector("input") as HTMLInputElement, {
      target: { value: "Edited again" },
    });
    fireEvent.click(screen.getByTestId("render-edit-submit"));
    // Exactly one create (the first submit) followed by an update, never a
    // second create — the singleton wrapper must have flipped branches.
    await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(write).toHaveBeenLastCalledWith("tasks:write:task:update", expect.anything());
  });
});
