import { describe, expect, jest, mock, test } from "bun:test";
import type {
  ActionFormScreenDefinition,
  EntityDefinition,
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import userEvent from "@testing-library/user-event";
import type { Dispatcher } from "../../headless/index.ts";
import { LIVE_REFETCH_COALESCE_MS } from "../../hooks/live-refetch-scheduler.ts";
import type { FeatureSchema, LiveEventSubscriber, NavTarget } from "../../index.ts";
import {
  DispatcherProvider,
  ExtensionSectionsProvider,
  KumikoScreen,
  LIVE_RESYNC_EVENT_TYPE,
  LiveEventsProvider,
  NavProvider,
  UserRolesProvider,
} from "../../index.ts";
import {
  clickSubmitOnceEnabled,
  defaultEnText,
  editScreen,
  schema,
} from "./_kumiko-screen-helpers.tsx";
import {
  act,
  fireEvent,
  makeDispatcher,
  render,
  screen,
  taskEntity,
  waitFor,
} from "./test-utils.tsx";

describe("KumikoScreen", () => {
  test("unknown qn → unavailable empty state", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <KumikoScreen schema={schema} qn="tasks:screen:ghost" />
      </DispatcherProvider>,
    );
    expect(screen.getByTestId("kumiko-screen-not-found")).toBeTruthy();
  });

  test("role-gated screen, no UserRolesProvider mounted → access-denied placeholder", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <KumikoScreen schema={schema} qn="tasks:screen:task-list-restricted" />
      </DispatcherProvider>,
    );
    expect(screen.getByTestId("kumiko-screen-access-denied")).toBeTruthy();
  });

  test("role-gated screen, user without matching role → access-denied placeholder", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <UserRolesProvider roles={["Viewer"]}>
          <KumikoScreen schema={schema} qn="tasks:screen:task-list-restricted" />
        </UserRolesProvider>
      </DispatcherProvider>,
    );
    expect(screen.getByTestId("kumiko-screen-access-denied")).toBeTruthy();
  });

  test("role-gated screen, user with matching role → renders normally", async () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <UserRolesProvider roles={["Admin"]}>
          <KumikoScreen schema={schema} qn="tasks:screen:task-list-restricted" />
        </UserRolesProvider>
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());
    expect(screen.queryByTestId("kumiko-screen-access-denied")).toBeNull();
    expect(screen.getByTestId("render-list-table-toolbar")).toBeTruthy();
  });

  test("entityEdit → renders RenderEdit form for the screen's entity", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <KumikoScreen schema={schema} qn="tasks:screen:task-edit" />
      </DispatcherProvider>,
    );
    expect(screen.getByTestId("render-edit-form")).toBeTruthy();
    expect(screen.getByTestId("field-title")).toBeTruthy();
    expect(screen.getByTestId("field-count")).toBeTruthy();
    expect(screen.getByTestId("field-done")).toBeTruthy();
  });

  test("entityList → fires useQuery with derived query QN and renders RenderList", async () => {
    const seenTypes: string[] = [];
    const query = mock(async (type: string) => {
      seenTypes.push(type);
      return {
        isSuccess: true,
        data: {
          rows: [{ id: "r1", title: "hello", count: 3, done: false }],
          nextCursor: null,
        },
      } as never;
    });
    const dispatcher = makeDispatcher({
      query: query as unknown as Dispatcher["query"],
    });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="tasks:screen:task-list" />
      </DispatcherProvider>,
    );

    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());
    expect(screen.getByTestId("render-list-table")).toBeTruthy();
    expect(screen.getByTestId("cell-r1-title").textContent).toBe("hello");
    // Derived query QN matches the server-side qualification rule.
    expect(seenTypes).toEqual(["tasks:query:task:list"]);
  });

  // #2062: the search box is a dead toolbar slot (and a guaranteed 422,
  // #2032) once the client knows the server has no SearchAdapter wired.
  describe("entityList search box gated on schema.searchAdapterMissing (#2062)", () => {
    const searchableWidgetEntity = {
      fields: { title: { type: "text", required: true, searchable: true } },
    } as unknown as EntityDefinition;
    const autoSearchScreen: EntityListScreenDefinition = {
      id: "widget-list",
      type: "entityList",
      entity: "widget",
      columns: ["title"],
    };
    const explicitSearchScreen: EntityListScreenDefinition = {
      id: "widget-list-explicit",
      type: "entityList",
      entity: "widget",
      columns: ["title"],
      searchable: true,
    };
    const explicitNoSearchScreen: EntityListScreenDefinition = {
      id: "widget-list-no-search",
      type: "entityList",
      entity: "widget",
      columns: ["title"],
      searchable: false,
    };

    function buildWidgetSchema(
      screenDef: EntityListScreenDefinition,
      searchAdapterMissing?: boolean,
    ): FeatureSchema {
      return {
        featureName: "widgets",
        entities: { widget: searchableWidgetEntity },
        screens: [screenDef],
        ...(searchAdapterMissing !== undefined && { searchAdapterMissing }),
      };
    }

    async function renderWidgetList(schemaDef: FeatureSchema, qn: string): Promise<void> {
      render(
        <DispatcherProvider dispatcher={makeDispatcher()}>
          <KumikoScreen schema={schemaDef} qn={qn} />
        </DispatcherProvider>,
      );
      await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());
    }

    test("auto-detected searchable field renders the search box when the flag is absent", async () => {
      await renderWidgetList(buildWidgetSchema(autoSearchScreen), "widgets:screen:widget-list");
      expect(document.querySelector("#render-list-search")).not.toBeNull();
    });

    test("searchAdapterMissing: true hides the search box despite an auto-detected searchable field", async () => {
      await renderWidgetList(
        buildWidgetSchema(autoSearchScreen, true),
        "widgets:screen:widget-list",
      );
      expect(document.querySelector("#render-list-search")).toBeNull();
    });

    test("searchAdapterMissing: true hides the search box even when screen.searchable is explicitly true", async () => {
      await renderWidgetList(
        buildWidgetSchema(explicitSearchScreen, true),
        "widgets:screen:widget-list-explicit",
      );
      expect(document.querySelector("#render-list-search")).toBeNull();
    });

    test("screen.searchable: false stays hidden regardless of searchAdapterMissing", async () => {
      await renderWidgetList(
        buildWidgetSchema(explicitNoSearchScreen, false),
        "widgets:screen:widget-list-no-search",
      );
      expect(document.querySelector("#render-list-search")).toBeNull();
    });
  });

  test("entityEdit with unknown entity on the screen → entity-missing placeholder", () => {
    const brokenScreen: EntityEditScreenDefinition = {
      id: "broken",
      type: "entityEdit",
      entity: "ghost-entity",
      layout: { sections: [{ title: "x", fields: [] }] },
    };
    const brokenSchema: FeatureSchema = {
      ...schema,
      screens: [brokenScreen],
    };
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <KumikoScreen schema={brokenSchema} qn="tasks:screen:broken" />
      </DispatcherProvider>,
    );
    expect(screen.getByTestId("kumiko-screen-entity-missing")).toBeTruthy();
  });

  test("entityEdit mit entityId → lädt detail, pre-fillt Form, submit update mit {id,version,changes}", async () => {
    const writeCalls: { type: string; payload: unknown }[] = [];
    const dispatcher = makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { id: "task-1", version: 7, title: "loaded-title", count: 3, done: false },
      })) as unknown as Dispatcher["query"],
      write: (async (type: string, payload: unknown) => {
        writeCalls.push({ type, payload });
        return { isSuccess: true, data: { id: "task-1" } };
      }) as unknown as Dispatcher["write"],
    });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="tasks:screen:task-edit" entityId="task-1" />
      </DispatcherProvider>,
    );

    // Zuerst Loading, dann Form mit den geladenen Werten.
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());
    expect(screen.getByTestId("render-edit-form")).toBeTruthy();
    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    expect(titleInput.value).toBe("loaded-title");

    // Edit + submit → write command trägt { id, version, changes: {title} }
    fireEvent.change(titleInput, { target: { value: "edited-title" } });
    await clickSubmitOnceEnabled();

    await waitFor(() => expect(writeCalls.length).toBe(1));
    const [call] = writeCalls;
    expect(call?.type).toBe("tasks:write:task:update");
    expect(call?.payload).toEqual({
      id: "task-1",
      version: 7,
      changes: { title: "edited-title" },
    });
  });

  // Regression-Anker für den Set-Value-UI-Bug: die extension-section muss im
  // Update-Mode die ECHTE entity-id bekommen — durch den vollen Flow
  // (KumikoScreen → detail-load → EntityEditUpdateForm → RenderEdit → Mount).
  // EntityEditUpdateForm lässt `id` bewusst aus den Form-values (id ist keine
  // deklarierte Field), also reicht NUR der route-entityId-Durchgriff. Ohne
  // ihn fiele die Section auf vm.id (=values["id"]=undefined) zurück und zeigte
  // create-mode trotz Edit. Der alte render-edit-Test mockte `initial.id`
  // manuell und war für genau diesen Flow blind — dieser Test rendert den
  // realen detail-Pfad, der das in CI gefangen hätte.
  test("entityEdit mit entityId → extension-section bekommt die echte entity-id (nicht create-mode)", async () => {
    const editScreenWithExtension: EntityEditScreenDefinition = {
      id: "task-edit-ext",
      type: "entityEdit",
      entity: "task",
      layout: {
        sections: [
          { title: "Basics", fields: ["title"] },
          {
            kind: "extension",
            title: "Custom Fields",
            component: { react: { __component: "TaskCustomFields" } },
          },
        ],
      },
    };
    const extSchema: FeatureSchema = {
      featureName: "tasks",
      entities: { task: taskEntity },
      screens: [editScreenWithExtension],
    };
    const TaskCustomFields = ({
      entityName,
      entityId,
      initialValues,
    }: {
      entityName: string;
      entityId: string | null;
      initialValues?: Readonly<Record<string, unknown>>;
    }) => (
      <div data-testid="task-custom-fields">
        {entityName}:{entityId ?? "(create)"}:{String(initialValues?.["vendor"] ?? "(no-value)")}
      </div>
    );
    const dispatcher = makeDispatcher({
      // detail liefert die row MIT id + customFields-jsonb. Update-Form
      // filtert id aus den Form-values (Section darf nicht create-mode
      // sein) UND die Section muss den gespeicherten customFields-Bestand
      // bekommen (sonst write-only → Read-Back leer).
      query: (async () => ({
        isSuccess: true,
        data: {
          id: "task-1",
          version: 7,
          title: "loaded",
          count: 0,
          done: false,
          customFields: { vendor: "Hetzner" },
        },
      })) as unknown as Dispatcher["query"],
    });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <ExtensionSectionsProvider value={{ TaskCustomFields }}>
          <KumikoScreen schema={extSchema} qn="tasks:screen:task-edit-ext" entityId="task-1" />
        </ExtensionSectionsProvider>
      </DispatcherProvider>,
    );

    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());
    const section = screen.getByTestId("task-custom-fields");
    // Anker: (1) echte route-id statt "(create)" [create-mode-Bug],
    //        (2) gespeicherter customFields-Wert statt "(no-value)" [write-only-Bug].
    expect(section.textContent).toBe("task:task-1:Hetzner");
  });

  test("entityList onRowClick → Callback feuert mit Row-Viewmodel", async () => {
    const clicks: { id: string }[] = [];
    const dispatcher = makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: {
          rows: [{ id: "row-1", title: "hello", count: 3, done: false }],
          nextCursor: null,
        },
      })) as unknown as Dispatcher["query"],
    });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen
          schema={schema}
          qn="tasks:screen:task-list"
          onRowClick={(row) => clicks.push({ id: row.id })}
        />
      </DispatcherProvider>,
    );

    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());
    fireEvent.click(screen.getByTestId("row-row-1"));
    expect(clicks).toEqual([{ id: "row-1" }]);
  });

  test("entityEdit update-mode: Delete-Button öffnet Confirm-Dialog + write('delete')", async () => {
    const user = userEvent.setup();
    const writeCalls: { type: string; payload: unknown }[] = [];
    const dispatcher = makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { id: "task-1", version: 7, title: "loaded", count: 3, done: false },
      })) as unknown as Dispatcher["query"],
      write: (async (type: string, payload: unknown) => {
        writeCalls.push({ type, payload });
        return { isSuccess: true, data: {} };
      }) as unknown as Dispatcher["write"],
    });
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="tasks:screen:task-edit" entityId="task-1" />
      </DispatcherProvider>,
    );

    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());

    // userEvent statt fireEvent: Radix Dialog feuert async State-Updates
    // (Presence/FocusScope/DismissableLayer) — fireEvent würde sie un-
    // gewickelt lassen und mit ~26 act()-Warnings spammen.
    await user.click(screen.getByTestId("render-edit-delete"));
    expect(screen.getByTestId("render-edit-delete-dialog")).toBeTruthy();
    expect(writeCalls.length).toBe(0);

    await user.click(screen.getByTestId("render-edit-delete-dialog-confirm"));
    await waitFor(() => expect(writeCalls.length).toBe(1));
    expect(writeCalls[0]).toEqual({
      type: "tasks:write:task:delete",
      payload: { id: "task-1" },
    });
  });

  async function deleteRejectedWith(
    details: Record<string, unknown> | undefined,
    translate?: (key: string, params?: Record<string, unknown>) => string,
  ): Promise<{ readonly onNavigate: ReturnType<typeof mock> }> {
    const user = userEvent.setup();
    const onNavigate = mock();
    const dispatcher = makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { id: "task-1", version: 7, title: "loaded", count: 3, done: false },
      })) as unknown as Dispatcher["query"],
      write: (async () => ({
        isSuccess: false,
        error: {
          code: "validation_error",
          httpStatus: 400,
          i18nKey: "errors.validation.failed",
          i18nParams: { limit: 3 },
          message: "Validation failed",
          ...(details !== undefined && { details }),
        },
      })) as unknown as Dispatcher["write"],
    });
    const memoryNav = {
      route: { screenId: "task-edit" },
      navigate: onNavigate,
      replace: onNavigate,
      hrefFor: () => "",
      searchParams: {},
      setSearchParams: () => undefined,
    };
    render(
      <NavProvider value={memoryNav}>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen
            schema={schema}
            qn="tasks:screen:task-edit"
            entityId="task-1"
            {...(translate !== undefined && { translate })}
          />
        </DispatcherProvider>
      </NavProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());
    await user.click(screen.getByTestId("render-edit-delete"));
    await user.click(screen.getByTestId("render-edit-delete-dialog-confirm"));
    return { onNavigate };
  }

  test("entityEdit update-mode: abgelehntes Delete zeigt den Feldfehler im Banner, Dialog zu, keine Navigation", async () => {
    const { onNavigate } = await deleteRejectedWith({
      fields: [{ path: "id", code: "custom", i18nKey: "tasks.errors.delete-blocked" }],
    });

    const banner = await screen.findByTestId("render-edit-form-error-key");
    expect(banner.textContent).toContain("tasks.errors.delete-blocked");
    await waitFor(() => expect(screen.queryByTestId("render-edit-delete-dialog")).toBeNull());
    expect(onNavigate).not.toHaveBeenCalled();
    expect(screen.queryByTestId("render-edit-delete")).not.toBeNull();
  });

  test("entityEdit update-mode: abgelehntes Delete mit mehreren Feldfehlern listet alle im Banner", async () => {
    await deleteRejectedWith({
      fields: [
        { path: "id", code: "custom", i18nKey: "tasks.errors.blocked-by-a" },
        { path: "id", code: "custom", i18nKey: "tasks.errors.blocked-by-b" },
      ],
    });

    const banner = await screen.findByTestId("render-edit-form-error");
    expect(banner.textContent).toContain("tasks.errors.blocked-by-a");
    expect(banner.textContent).toContain("tasks.errors.blocked-by-b");
  });

  test("entityEdit update-mode: abgelehntes Delete ohne Feldfehler zeigt den Top-Level-Key", async () => {
    await deleteRejectedWith(undefined);

    const banner = await screen.findByTestId("render-edit-form-error-key");
    expect(banner.textContent).toContain("Validation failed");
  });

  test("entityEdit update-mode: i18nParams des abgelehnten Deletes werden im Banner interpoliert", async () => {
    await deleteRejectedWith(
      {
        fields: [
          { path: "id", code: "custom", i18nKey: "tasks.errors.too-many", params: { max: 5 } },
        ],
      },
      (key, params) => `${key}|${JSON.stringify(params ?? {})}`,
    );

    const banner = await screen.findByTestId("render-edit-form-error-key");
    expect(banner.textContent).toContain('tasks.errors.too-many|{"max":5}');
  });

  test("entityEdit create-mode: kein Delete-Button (keine entity-id → nichts zu löschen)", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <KumikoScreen schema={schema} qn="tasks:screen:task-edit" />
      </DispatcherProvider>,
    );
    expect(screen.queryByTestId("render-edit-delete")).toBeNull();
  });

  // Issue #912 — Copy-Link-Action. KumikoScreen threads an already-bound
  // onCopyLink callback down to RenderEdit (the actual URL-build/clipboard
  // impl lives in renderer/web's RoutedScreen, outside this test — here we
  // only verify the wiring: button renders icon-only in update-mode, fires
  // the callback, and swaps its accessible name to "copied" afterwards.
  test("entityEdit update-mode: Copy-Link-Button feuert onCopyLink + zeigt 'copied'-Accessible-Name", async () => {
    const user = userEvent.setup();
    const onCopyLink = mock(() => Promise.resolve());
    const dispatcher = makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { id: "task-1", version: 1, title: "loaded", count: 3, done: false },
      })) as unknown as Dispatcher["query"],
    });
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen
          schema={schema}
          qn="tasks:screen:task-edit"
          entityId="task-1"
          onCopyLink={onCopyLink}
        />
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());

    const button = screen.getByTestId("render-edit-copy-link");
    // Icon + visible label; accessible name comes from the label text itself.
    expect(button.textContent).toBe("Copy link");
    expect(button.querySelector("svg")).toBeTruthy();
    await user.click(button);
    expect(onCopyLink).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(button.textContent).toBe("Copied!"));
  });

  test("entityEdit create-mode: kein Copy-Link-Button (keine entity-id → kein Permalink)", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <KumikoScreen
          schema={schema}
          qn="tasks:screen:task-edit"
          onCopyLink={() => Promise.resolve()}
        />
      </DispatcherProvider>,
    );
    expect(screen.queryByTestId("render-edit-copy-link")).toBeNull();
  });

  test("entityEdit update-mode ohne onCopyLink-Prop: kein Copy-Link-Button", async () => {
    const dispatcher = makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { id: "task-1", version: 1, title: "loaded", count: 3, done: false },
      })) as unknown as Dispatcher["query"],
    });
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="tasks:screen:task-edit" entityId="task-1" />
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());
    expect(screen.queryByTestId("render-edit-copy-link")).toBeNull();
  });

  test("entityEdit update-mode: version_conflict → Banner + 'Neu laden' triggert detail-refetch", async () => {
    let detailCalls = 0;
    const dispatcher = makeDispatcher({
      query: (async () => {
        detailCalls += 1;
        return {
          isSuccess: true,
          data: {
            id: "task-1",
            version: detailCalls,
            title: `v${detailCalls}`,
            count: 0,
            done: false,
          },
        };
      }) as unknown as Dispatcher["query"],
      write: (async () => ({
        isSuccess: false,
        error: {
          code: "version_conflict",
          httpStatus: 409,
          i18nKey: "errors.versionConflict",
          message: "stale",
        },
      })) as unknown as Dispatcher["write"],
    });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="tasks:screen:task-edit" entityId="task-1" />
      </DispatcherProvider>,
    );

    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());
    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;

    // Dirty machen damit der Submit überhaupt feuert.
    fireEvent.change(titleInput, { target: { value: "edited" } });
    await clickSubmitOnceEnabled();

    // Banner zeigt die ÜBERSETZTE version-conflict-Message (kein roher i18nKey)
    // und bietet einen Reload-Button. Gegen das Default-Bundle assertet, damit
    // die Verdrahtung i18nKey → translate → Banner geprüft wird, ohne am
    // konkreten Wording festzukleben.
    await waitFor(() => expect(screen.queryByTestId("render-edit-form-error")).toBeTruthy());
    expect(screen.getByTestId("render-edit-form-error-key").textContent).toBe(
      defaultEnText("errors.versionConflict"),
    );

    expect(detailCalls).toBe(1);
    fireEvent.click(screen.getByTestId("render-edit-form-error-reload"));
    await waitFor(() => expect(detailCalls).toBe(2));
    // Banner verschwindet nach dem Reload.
    expect(screen.queryByTestId("render-edit-form-error")).toBeNull();
  });

  test("entityEdit update-mode: query-Error zeigt übersetzten Text statt rohem i18nKey (issue #1193)", async () => {
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
        <KumikoScreen schema={schema} qn="tasks:screen:task-edit" entityId="task-1" />
      </DispatcherProvider>,
    );

    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-error")).toBeTruthy());
    const bannerText = screen.getByTestId("kumiko-screen-error").textContent;
    expect(bannerText).toContain(defaultEnText("errors.access.denied"));
    expect(bannerText).not.toContain("errors.access.denied");
  });

  test("entityList: query-Error zeigt übersetzten Text statt rohem i18nKey (issue #1193)", async () => {
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
        <KumikoScreen schema={schema} qn="tasks:screen:task-list" />
      </DispatcherProvider>,
    );

    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-error")).toBeTruthy());
    const bannerText = screen.getByTestId("kumiko-screen-error").textContent;
    expect(bannerText).toContain(defaultEnText("errors.access.denied"));
    expect(bannerText).not.toContain("errors.access.denied");
  });

  test("entityList: a failed live refetch shows the error banner above the rows instead of replacing them", async () => {
    let queryCalls = 0;
    const dispatcher = makeDispatcher({
      query: (async () => {
        queryCalls += 1;
        if (queryCalls === 1) {
          return {
            isSuccess: true,
            data: {
              rows: [{ id: "r1", title: "Alpha", count: 1, done: false }],
              nextCursor: null,
            },
          };
        }
        return {
          isSuccess: false,
          error: { code: "unknown", httpStatus: 500, i18nKey: "errors.unknown", message: "boom" },
        };
      }) as unknown as Dispatcher["query"],
    });
    let emitLive: () => void = () => {};
    const subscribe: LiveEventSubscriber = (entity, listener) => {
      emitLive = () =>
        listener({
          type: entity,
          data: {
            aggregateType: entity,
            eventType: LIVE_RESYNC_EVENT_TYPE,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        });
      return () => {};
    };

    jest.useFakeTimers();
    try {
      render(
        <DispatcherProvider dispatcher={dispatcher}>
          <LiveEventsProvider value={subscribe}>
            <KumikoScreen schema={schema} qn="tasks:screen:task-list" />
          </LiveEventsProvider>
        </DispatcherProvider>,
      );
      await act(async () => {});
      expect(screen.getByText("Alpha")).toBeTruthy();
      expect(screen.queryByTestId("kumiko-screen-error")).toBeNull();

      emitLive();
      await act(async () => {
        jest.advanceTimersByTime(LIVE_REFETCH_COALESCE_MS);
      });

      expect(screen.getByTestId("kumiko-screen-error")).toBeTruthy();
      expect(screen.getByTestId("kumiko-screen-retry")).toBeTruthy();
      expect(screen.getByText("Alpha")).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  // RowActions-Mapping (Tier 2.7a Resolution-Layer): pinst dass
  // EntityListBody die Schema-Form (handler-QN, label-i18nKey, payload-
  // builder, visible-Function, confirmLabel) zu DataTableRowAction
  // (translated, dispatcher-resolved) korrekt transformiert. Vorher
  // nur indirekt über DataTable-Tests + manuelle Inspection abgedeckt.
  test("entityList rowActions: Schema → translate + dispatch wiring", async () => {
    const writeCalls: { type: string; payload: unknown }[] = [];
    const dispatcher = makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: {
          rows: [{ id: "r1", title: "Alpha", count: 1, done: false }],
          nextCursor: null,
        },
      })) as unknown as Dispatcher["query"],
      write: (async (type: string, payload: unknown) => {
        writeCalls.push({ type, payload });
        return { isSuccess: true, data: {} };
      }) as unknown as Dispatcher["write"],
    });

    const screenWithActions: EntityListScreenDefinition = {
      id: "task-list",
      type: "entityList",
      entity: "task",
      columns: ["title"],
      rowActions: [
        {
          id: "archive",
          label: "actions.archive",
          handler: "tasks:write:task:archive",
          payload: { pick: ["id"] },
        },
      ],
    };
    const schemaWithActions: FeatureSchema = {
      ...schema,
      screens: [screenWithActions],
    };

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schemaWithActions} qn="tasks:screen:task-list" />
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());

    // Inline-Button mit der ID aus dem Schema. Label kommt durch
    // translate() — fallback ist der Key wenn kein Bundle (test-utils
    // mountet eins mit identity-translator).
    const button = screen.getByTestId("row-r1-action-archive");
    expect(button).toBeTruthy();

    // Click → dispatcher.write mit handler-QN + custom payload (NICHT
    // default `{id}`, sondern der schema-payload-builder muss greifen).
    fireEvent.click(button);
    await waitFor(() => expect(writeCalls.length).toBe(1));
    expect(writeCalls[0]).toEqual({
      type: "tasks:write:task:archive",
      payload: { id: "r1" },
    });
  });

  test("entityList rowActions: display pins an action inline next to the kebab, rowActionMode inline shows all", async () => {
    const dispatcher = makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { rows: [{ id: "r1", title: "Alpha", count: 1, done: false }], nextCursor: null },
      })) as unknown as Dispatcher["query"],
    });
    const actions = [
      { id: "open", label: "actions.open", handler: "tasks:write:task:open", display: "button" },
      { id: "archive", label: "actions.archive", handler: "tasks:write:task:archive" },
      { id: "purge", label: "actions.purge", handler: "tasks:write:task:purge" },
    ] as const;
    const mount = async (rowActionMode?: "inline") => {
      const def: EntityListScreenDefinition = {
        id: "task-list",
        type: "entityList",
        entity: "task",
        columns: ["title"],
        rowActions: actions,
        ...(rowActionMode !== undefined && { rowActionMode }),
      };
      const view = render(
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen schema={{ ...schema, screens: [def] }} qn="tasks:screen:task-list" />
        </DispatcherProvider>,
      );
      await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());
      return view;
    };

    const adaptive = await mount();
    expect(screen.getByTestId("row-r1-action-open")).toBeTruthy();
    expect(screen.queryByTestId("row-r1-action-archive")).toBeNull();
    adaptive.unmount();

    await mount("inline");
    expect(screen.getByTestId("row-r1-action-archive")).toBeTruthy();
    expect(screen.getByTestId("row-r1-action-purge")).toBeTruthy();
  });

  // Regression zum Prod-Bug 2026-06-07 (Bug 4): dispatcher.write wirft
  // nicht — ein Failure-Result wurde verworfen, der Confirm-Dialog
  // schloss kommentarlos und der User sah "nichts passiert". Jetzt:
  // Dialog schließt UND ein destructive-Toast zeigt den Fehlertext.
  test("entityList rowActions writeHandler: fehlgeschlagener Write → Fehler-Toast statt stillem Dialog-Close", async () => {
    const dispatcher = makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: {
          rows: [{ id: "r1", title: "Alpha", count: 1, done: false }],
          nextCursor: null,
        },
      })) as unknown as Dispatcher["query"],
      write: (async () => ({
        isSuccess: false,
        error: {
          code: "conflict",
          httpStatus: 409,
          // Key absichtlich in keinem Bundle — dispatcherErrorText muss
          // auf error.message zurückfallen.
          i18nKey: "tasks.errors.delete-conflict",
          message: "Version conflict for entity r1",
        },
      })) as unknown as Dispatcher["write"],
    });

    const screenWithDelete: EntityListScreenDefinition = {
      id: "task-list",
      type: "entityList",
      entity: "task",
      columns: ["title"],
      rowActions: [
        {
          id: "delete",
          label: "actions.delete",
          handler: "tasks:write:task:delete",
          confirm: "actions.delete-confirm",
          style: "danger",
        },
      ],
    };

    const { ToastProvider } = await import("../primitives/toast.tsx");
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen
            schema={{ ...schema, screens: [screenWithDelete] }}
            qn="tasks:screen:task-list"
          />
        </DispatcherProvider>
      </ToastProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());

    // danger erzwingt den Confirm-Dialog.
    await user.click(screen.getByTestId("row-r1-action-delete"));
    expect(await screen.findByTestId("row-r1-action-delete-dialog")).toBeTruthy();

    await user.click(screen.getByTestId("row-r1-action-delete-dialog-confirm"));

    // Dialog schließt — aber NICHT kommentarlos: der Fehlertext ist da.
    await waitFor(() => expect(screen.queryByTestId("row-r1-action-delete-dialog")).toBeNull());
    expect(await screen.findByText("Version conflict for entity r1")).toBeTruthy();
  });

  // 284/2: der HIT-Zweig von dispatcherErrorText — bekannter i18nKey
  // mit Params → der ÜBERSETZTE, interpolierte Text landet im Toast
  // (nicht error.message). Genau die Logik, die die Funktion rechtfertigt.
  test("entityList rowActions writeHandler: bekannter i18nKey → übersetzter Toast mit interpolierten Params", async () => {
    const dispatcher = makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: {
          rows: [{ id: "r1", title: "Alpha", count: 1, done: false }],
          nextCursor: null,
        },
      })) as unknown as Dispatcher["query"],
      write: (async () => ({
        isSuccess: false,
        error: {
          code: "validation_error",
          httpStatus: 422,
          i18nKey: "kumiko.validation.too-short",
          i18nParams: { min: 5 },
          message: "raw fallback — must NOT appear",
        },
      })) as unknown as Dispatcher["write"],
    });

    const screenWithDelete: EntityListScreenDefinition = {
      id: "task-list",
      type: "entityList",
      entity: "task",
      columns: ["title"],
      rowActions: [
        {
          id: "delete",
          label: "actions.delete",
          handler: "tasks:write:task:delete",
          confirm: "actions.delete-confirm",
          style: "danger",
        },
      ],
    };

    const { ToastProvider } = await import("../primitives/toast.tsx");
    const { LocaleProvider, createStaticLocaleResolver, kumikoDefaultTranslations } = await import(
      "../../index.ts"
    );
    const user = userEvent.setup();
    render(
      <LocaleProvider
        resolver={createStaticLocaleResolver()}
        fallbackBundles={[kumikoDefaultTranslations]}
      >
        <ToastProvider>
          <DispatcherProvider dispatcher={dispatcher}>
            <KumikoScreen
              schema={{ ...schema, screens: [screenWithDelete] }}
              qn="tasks:screen:task-list"
            />
          </DispatcherProvider>
        </ToastProvider>
      </LocaleProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());

    await user.click(screen.getByTestId("row-r1-action-delete"));
    await user.click(screen.getByTestId("row-r1-action-delete-dialog-confirm"));

    expect(await screen.findByText("Too short (at least 5 characters).")).toBeTruthy();
    expect(screen.queryByText("raw fallback — must NOT appear")).toBeNull();
  });

  // navigate rowActions may carry style="danger" — it renders
  // red like the writeHandler variant, but does NOT force a confirm dialog
  // (the target form/screen is itself the confirmation).
  test("entityList rowActions kind=navigate mit style=danger: rot, aber navigiert sofort ohne Dialog", async () => {
    const navigateCalls: { screenId: string }[] = [];
    const memoryNav = {
      route: { screenId: "task-list" },
      navigate: (target: NavTarget) => {
        if ("screenId" in target) navigateCalls.push(target);
      },
      replace: () => undefined,
      hrefFor: (t: NavTarget) => ("screenId" in t ? `/${t.screenId}` : ""),
      searchParams: {},
      setSearchParams: () => undefined,
    };
    const dispatcher = makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: {
          rows: [{ id: "r1", title: "Alpha", count: 1, done: false }],
          nextCursor: null,
        },
      })) as unknown as Dispatcher["query"],
    });

    const screenWithDangerNav: EntityListScreenDefinition = {
      id: "task-list",
      type: "entityList",
      entity: "task",
      columns: ["title"],
      rowActions: [
        {
          kind: "navigate",
          id: "terminate",
          label: "actions.terminate",
          screen: "task-edit",
          style: "danger",
        },
      ],
    };

    const { NavProvider } = await import("../../index.ts");
    const user = userEvent.setup();
    render(
      <NavProvider value={memoryNav}>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen
            schema={{ ...schema, screens: [screenWithDangerNav] }}
            qn="tasks:screen:task-list"
          />
        </DispatcherProvider>
      </NavProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());

    const button = screen.getByTestId("row-r1-action-terminate");
    expect(button.className).toContain("text-destructive");

    await user.click(button);
    await waitFor(() => expect(navigateCalls).toEqual([{ screenId: "task-edit" }]));
    expect(screen.queryByTestId("row-r1-action-terminate-dialog")).toBeNull();
  });

  // Tier 2.7e-1: rowAction kind="navigate" — Click ruft nav.navigate
  // mit screen-id, ggf. mit URL-Search-Params aus params(row).
  // Reihenfolge ist Teil des Contracts: navigate ZUERST, dann
  // setSearchParams — pushState trägt keine Query, vorher gesetzte
  // Params kleben sonst an der alten URL (actionForm-Prefill leer).
  test("entityList rowActions kind=navigate: Click → nav.navigate, DANN setSearchParams", async () => {
    const calls: { kind: "navigate" | "setSearchParams"; value: unknown }[] = [];
    const navigateCalls: { screenId: string }[] = [];
    const searchParamUpdates: Record<string, string | null>[] = [];
    const memoryNav = {
      route: { screenId: "task-list" },
      navigate: (target: NavTarget) => {
        calls.push({ kind: "navigate", value: target });
        if ("screenId" in target) navigateCalls.push(target);
      },
      replace: () => undefined,
      hrefFor: (t: NavTarget) => ("screenId" in t ? `/${t.screenId}` : ""),
      searchParams: {},
      setSearchParams: (u: Record<string, string | null>) => {
        calls.push({ kind: "setSearchParams", value: u });
        searchParamUpdates.push(u);
      },
    };
    const dispatcher = makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: {
          rows: [{ id: "r1", title: "Alpha", count: 1, done: false }],
          nextCursor: null,
        },
      })) as unknown as Dispatcher["query"],
    });

    const screenWithNav: EntityListScreenDefinition = {
      id: "task-list",
      type: "entityList",
      entity: "task",
      columns: ["title"],
      rowActions: [
        {
          kind: "navigate",
          id: "edit",
          label: "actions.edit",
          screen: "task-edit",
          params: { map: { taskId: "id" } },
        },
      ],
    };

    const { NavProvider } = await import("../../index.ts");
    const user = userEvent.setup();
    render(
      <NavProvider value={memoryNav}>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen
            schema={{ ...schema, screens: [screenWithNav] }}
            qn="tasks:screen:task-list"
          />
        </DispatcherProvider>
      </NavProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());

    await user.click(screen.getByTestId("row-r1-action-edit"));
    await waitFor(() => expect(navigateCalls.length).toBe(1));
    expect(navigateCalls[0]).toEqual({ screenId: "task-edit" });
    // params werden zu Strings serialisiert (URL-Layer kennt nur Strings).
    // returnTo: "task-list" — this KumikoScreen has no outer host, so it becomes its own.
    expect(searchParamUpdates).toEqual([{ taskId: "r1", returnTo: "task-list" }]);
    // Reihenfolge-Pin: erst navigate, dann setSearchParams.
    expect(calls.map((c) => c.kind)).toEqual(["navigate", "setSearchParams"]);
  });

  // 284/3: derselbe Contract gegen die ECHTE useBrowserNavApi statt
  // memoryNav — der eigentliche Bug-Mechanismus (pushState verwirft die
  // Query, setSearchParams muss auf der NEUEN URL landen) ist nur hier
  // real verifiziert. Kombination navigate + entityId + params.
  test("entityList rowActions kind=navigate: echte useBrowserNavApi → Pfad-Segmente + ?param auf der neuen URL", async () => {
    window.history.replaceState(null, "", "/task-list");

    const dispatcher = makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: {
          rows: [{ id: "r1", title: "Alpha", count: 1, done: false }],
          nextCursor: null,
        },
      })) as unknown as Dispatcher["query"],
    });

    const screenWithNav: EntityListScreenDefinition = {
      id: "task-list",
      type: "entityList",
      entity: "task",
      columns: ["title"],
      rowActions: [
        {
          kind: "navigate",
          id: "edit",
          label: "actions.edit",
          screen: "task-edit",
          entityId: "id",
          params: { map: { from: "title" } },
        },
      ],
    };

    const { NavProvider } = await import("../../index.ts");
    const { useBrowserNavApi } = await import("../app/nav.tsx");
    function BrowserNav({ children }: { readonly children: React.ReactNode }): React.ReactNode {
      const api = useBrowserNavApi({ hasWorkspaces: false });
      return <NavProvider value={api}>{children}</NavProvider>;
    }

    const user = userEvent.setup();
    render(
      <BrowserNav>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen
            schema={{ ...schema, screens: [screenWithNav] }}
            qn="tasks:screen:task-list"
          />
        </DispatcherProvider>
      </BrowserNav>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());

    await user.click(screen.getByTestId("row-r1-action-edit"));

    await waitFor(() => expect(window.location.pathname).toBe("/task-edit/r1"));
    expect(new URLSearchParams(window.location.search).get("from")).toBe("Alpha");
  });

  // entityId-Variante: entityEdit-Targets brauchen die Id als PFAD-
  // Segment (route.entityId), nicht als Search-Param — sonst öffnet
  // der Edit-Screen im Create-Mode (Prod-Bug 2026-06-07, Bug 3).
  test("entityList rowActions kind=navigate mit entityId: Id landet im NavTarget, nicht in den Search-Params", async () => {
    const navigateCalls: { screenId: string; entityId?: string }[] = [];
    const searchParamUpdates: Record<string, string | null>[] = [];
    const memoryNav = {
      route: { screenId: "task-list" },
      navigate: (target: NavTarget) => {
        if ("screenId" in target) navigateCalls.push(target);
      },
      replace: () => undefined,
      hrefFor: (t: NavTarget) => ("screenId" in t ? `/${t.screenId}` : ""),
      searchParams: {},
      setSearchParams: (u: Record<string, string | null>) => searchParamUpdates.push(u),
    };
    const dispatcher = makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: {
          rows: [{ id: "r1", title: "Alpha", count: 1, done: false }],
          nextCursor: null,
        },
      })) as unknown as Dispatcher["query"],
    });

    const screenWithEdit: EntityListScreenDefinition = {
      id: "task-list",
      type: "entityList",
      entity: "task",
      columns: ["title"],
      rowActions: [
        {
          kind: "navigate",
          id: "edit",
          label: "actions.edit",
          screen: "task-edit",
          entityId: "id",
        },
      ],
    };

    const { NavProvider } = await import("../../index.ts");
    const user = userEvent.setup();
    render(
      <NavProvider value={memoryNav}>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen
            schema={{ ...schema, screens: [screenWithEdit] }}
            qn="tasks:screen:task-list"
          />
        </DispatcherProvider>
      </NavProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());

    await user.click(screen.getByTestId("row-r1-action-edit"));
    await waitFor(() => expect(navigateCalls.length).toBe(1));
    expect(navigateCalls[0]).toEqual({ screenId: "task-edit", entityId: "r1" });
    // No declared params, but returnTo still attaches — the id itself never
    // leaks into search params (that's the point above).
    expect(searchParamUpdates).toEqual([{ returnTo: "task-list" }]);
  });

  // JSON-Schema-Fall (GET /api/schema): Declarative entityId: "id"
  // überlebt JSON.stringify (String, kein Function-Drop). Das Schema
  // funktioniert identisch ob direkt oder nach JSON-Roundtrip geladen.
  test("entityList rowActions kind=navigate auf entityEdit-Ziel: entityId-String überlebt JSON-Roundtrip (JSON-Schema-sicher)", async () => {
    const navigateCalls: { screenId: string; entityId?: string }[] = [];
    const memoryNav = {
      route: { screenId: "task-list" },
      navigate: (target: NavTarget) => {
        if ("screenId" in target) navigateCalls.push(target);
      },
      replace: () => undefined,
      hrefFor: (t: NavTarget) => ("screenId" in t ? `/${t.screenId}` : ""),
      searchParams: {},
      setSearchParams: () => undefined,
    };
    const dispatcher = makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: {
          rows: [{ id: "r1", title: "Alpha", count: 1, done: false }],
          nextCursor: null,
        },
      })) as unknown as Dispatcher["query"],
    });

    const screenWithEdit: EntityListScreenDefinition = {
      id: "task-list",
      type: "entityList",
      entity: "task",
      columns: ["title"],
      rowActions: [
        {
          kind: "navigate",
          id: "edit",
          label: "actions.edit",
          screen: "task-edit",
          entityId: "id",
        },
      ],
    };
    const jsonSchema = JSON.parse(
      JSON.stringify({ ...schema, screens: [screenWithEdit, editScreen] }),
    ) as FeatureSchema;

    const { NavProvider } = await import("../../index.ts");
    const user = userEvent.setup();
    render(
      <NavProvider value={memoryNav}>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen schema={jsonSchema} qn="tasks:screen:task-list" />
        </DispatcherProvider>
      </NavProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());

    await user.click(screen.getByTestId("row-r1-action-edit"));
    await waitFor(() => expect(navigateCalls.length).toBe(1));
    expect(navigateCalls[0]).toEqual({ screenId: "task-edit", entityId: "r1" });
  });

  test("entityList rowActions kind=navigate auf NICHT-entityEdit-Ziel: kein entityId-Default", async () => {
    const navigateCalls: { screenId: string; entityId?: string }[] = [];
    const memoryNav = {
      route: { screenId: "task-list" },
      navigate: (target: NavTarget) => {
        if ("screenId" in target) navigateCalls.push(target);
      },
      replace: () => undefined,
      hrefFor: (t: NavTarget) => ("screenId" in t ? `/${t.screenId}` : ""),
      searchParams: {},
      setSearchParams: () => undefined,
    };
    const dispatcher = makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: {
          rows: [{ id: "r1", title: "Alpha", count: 1, done: false }],
          nextCursor: null,
        },
      })) as unknown as Dispatcher["query"],
    });

    const actionScreen: ActionFormScreenDefinition = {
      id: "task-approve",
      type: "actionForm",
      handler: "tasks:write:task:approve",
      fields: { note: { type: "text" } } as ActionFormScreenDefinition["fields"],
      layout: { sections: [{ title: "x", fields: ["note"] }] },
    };
    const screenWithNav: EntityListScreenDefinition = {
      id: "task-list",
      type: "entityList",
      entity: "task",
      columns: ["title"],
      rowActions: [
        { kind: "navigate", id: "approve", label: "actions.approve", screen: "task-approve" },
      ],
    };

    const { NavProvider } = await import("../../index.ts");
    const user = userEvent.setup();
    render(
      <NavProvider value={memoryNav}>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen
            schema={{ ...schema, screens: [screenWithNav, actionScreen] }}
            qn="tasks:screen:task-list"
          />
        </DispatcherProvider>
      </NavProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());

    await user.click(screen.getByTestId("row-r1-action-approve"));
    await waitFor(() => expect(navigateCalls.length).toBe(1));
    // actionForm-Ziel: row-Kontext kommt via params/searchParams, NICHT
    // als Pfad-Segment — kein entityId-Default.
    expect(navigateCalls[0]).toEqual({ screenId: "task-approve" });
  });

  test("entityList rowActions kind=navigate ohne eigene params: setSearchParams trägt nur returnTo", async () => {
    const navigateCalls: { screenId: string }[] = [];
    const searchParamUpdates: Record<string, string | null>[] = [];
    const memoryNav = {
      route: { screenId: "task-list" },
      navigate: (target: NavTarget) => {
        if ("screenId" in target) navigateCalls.push(target);
      },
      replace: () => undefined,
      hrefFor: (t: NavTarget) => ("screenId" in t ? `/${t.screenId}` : ""),
      searchParams: {},
      setSearchParams: (u: Record<string, string | null>) => searchParamUpdates.push(u),
    };
    const dispatcher = makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: {
          rows: [{ id: "r1", title: "Alpha", count: 1, done: false }],
          nextCursor: null,
        },
      })) as unknown as Dispatcher["query"],
    });

    const screenWithNav: EntityListScreenDefinition = {
      id: "task-list",
      type: "entityList",
      entity: "task",
      columns: ["title"],
      rowActions: [{ kind: "navigate", id: "view", label: "actions.view", screen: "task-edit" }],
    };
    const { NavProvider } = await import("../../index.ts");
    const user = userEvent.setup();
    render(
      <NavProvider value={memoryNav}>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen
            schema={{ ...schema, screens: [screenWithNav] }}
            qn="tasks:screen:task-list"
          />
        </DispatcherProvider>
      </NavProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());

    await user.click(screen.getByTestId("row-r1-action-view"));
    await waitFor(() => expect(navigateCalls.length).toBe(1));
    // No declared params, but returnTo still attaches.
    expect(searchParamUpdates).toEqual([{ returnTo: "task-list" }]);
  });

  // toolbarActions: Schema-Form (kind: navigate | writeHandler) →
  // Resolved-Form (onTrigger callback). Pinst beide kinds:
  //  - navigate dispatch ein nav.navigate({ screenId })
  //  - writeHandler dispatched dispatcher.write(handler, payload?())
  test("entityList toolbarActions navigate-kind: Click → nav.navigate", async () => {
    const navigateCalls: { screenId: string }[] = [];
    const dispatcher = makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { rows: [{ id: "r1", title: "x", count: 0, done: false }], nextCursor: null },
      })) as unknown as Dispatcher["query"],
    });
    const memoryNav = {
      route: { screenId: "task-list" },
      navigate: (target: NavTarget) => {
        if ("screenId" in target) navigateCalls.push(target);
      },
      replace: () => undefined,
      hrefFor: (t: NavTarget) => ("screenId" in t ? `/${t.screenId}` : ""),
      searchParams: {},
      setSearchParams: () => undefined,
    };
    const screenWithToolbar: EntityListScreenDefinition = {
      id: "task-list",
      type: "entityList",
      entity: "task",
      columns: ["title"],
      toolbarActions: [
        { kind: "navigate", id: "open", label: "actions.open", screen: "task-edit" },
      ],
    };

    const { NavProvider } = await import("../../index.ts");
    const user = userEvent.setup();
    render(
      <NavProvider value={memoryNav}>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen
            schema={{ ...schema, screens: [screenWithToolbar] }}
            qn="tasks:screen:task-list"
          />
        </DispatcherProvider>
      </NavProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());

    await user.click(screen.getByTestId("render-list-toolbar-action-open"));
    expect(navigateCalls).toEqual([{ screenId: "task-edit" }]);
  });

  // Same decoupling as the rowAction variant — style="danger" on a
  // navigate toolbarAction renders the destructive button variant without
  // forcing a confirm dialog.
  test("entityList toolbarActions navigate-kind mit style=danger: destructive Button, navigiert sofort ohne Dialog", async () => {
    const navigateCalls: { screenId: string }[] = [];
    const dispatcher = makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { rows: [{ id: "r1", title: "x", count: 0, done: false }], nextCursor: null },
      })) as unknown as Dispatcher["query"],
    });
    const memoryNav = {
      route: { screenId: "task-list" },
      navigate: (target: NavTarget) => {
        if ("screenId" in target) navigateCalls.push(target);
      },
      replace: () => undefined,
      hrefFor: (t: NavTarget) => ("screenId" in t ? `/${t.screenId}` : ""),
      searchParams: {},
      setSearchParams: () => undefined,
    };
    const screenWithToolbar: EntityListScreenDefinition = {
      id: "task-list",
      type: "entityList",
      entity: "task",
      columns: ["title"],
      toolbarActions: [
        {
          kind: "navigate",
          id: "terminate-all",
          label: "actions.terminate-all",
          screen: "task-edit",
          style: "danger",
        },
      ],
    };

    const { NavProvider } = await import("../../index.ts");
    const user = userEvent.setup();
    render(
      <NavProvider value={memoryNav}>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen
            schema={{ ...schema, screens: [screenWithToolbar] }}
            qn="tasks:screen:task-list"
          />
        </DispatcherProvider>
      </NavProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());

    const button = screen.getByTestId("render-list-toolbar-action-terminate-all");
    expect(button.getAttribute("data-variant")).toBe("destructive");

    await user.click(button);
    await waitFor(() => expect(navigateCalls).toEqual([{ screenId: "task-edit" }]));
    expect(screen.queryByTestId("render-list-toolbar-action-terminate-all-dialog")).toBeNull();
  });

  test("entityList toolbarActions writeHandler-kind: Click → dispatcher.write", async () => {
    const writeCalls: { type: string; payload: unknown }[] = [];
    const dispatcher = makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { rows: [{ id: "r1", title: "x", count: 0, done: false }], nextCursor: null },
      })) as unknown as Dispatcher["query"],
      write: (async (type: string, payload: unknown) => {
        writeCalls.push({ type, payload });
        return { isSuccess: true, data: {} };
      }) as unknown as Dispatcher["write"],
    });
    const screenWithToolbar: EntityListScreenDefinition = {
      id: "task-list",
      type: "entityList",
      entity: "task",
      columns: ["title"],
      toolbarActions: [
        {
          kind: "writeHandler",
          id: "sync",
          label: "actions.sync",
          handler: "tasks:write:task:sync",
          payload: { all: true },
        },
      ],
    };

    const user = userEvent.setup();
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen
          schema={{ ...schema, screens: [screenWithToolbar] }}
          qn="tasks:screen:task-list"
        />
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());

    await user.click(screen.getByTestId("render-list-toolbar-action-sync"));
    await waitFor(() => expect(writeCalls.length).toBe(1));
    expect(writeCalls[0]).toEqual({ type: "tasks:write:task:sync", payload: { all: true } });
  });
});
