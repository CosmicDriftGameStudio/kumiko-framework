import { describe, expect, mock, test } from "bun:test";
import type {
  ActionFormScreenDefinition,
  EntityDefinition,
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
  ProjectionListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import type { FeatureSchema, NavApi, NavTarget } from "@cosmicdrift/kumiko-renderer";
import {
  AppFeaturesProvider,
  DispatcherProvider,
  ExtensionSectionsProvider,
  KumikoScreen,
  kumikoDefaultTranslations,
  NavProvider,
  UserRolesProvider,
} from "@cosmicdrift/kumiko-renderer";
import userEvent from "@testing-library/user-event";
import { createMockDispatcher, fireEvent, render, screen, waitFor } from "./test-utils";

const taskEntity = {
  fields: {
    title: { type: "text", required: true },
    count: { type: "number" },
    done: { type: "boolean" },
  },
} as unknown as EntityDefinition;

const editScreen: EntityEditScreenDefinition = {
  id: "task-edit",
  type: "entityEdit",
  entity: "task",
  layout: {
    sections: [{ title: "Basics", fields: ["title", "count", "done"] }],
  },
};

const listScreen: EntityListScreenDefinition = {
  id: "task-list",
  type: "entityList",
  entity: "task",
  columns: ["title", "count", "done"],
};

const restrictedListScreen: EntityListScreenDefinition = {
  id: "task-list-restricted",
  type: "entityList",
  entity: "task",
  columns: ["title"],
  access: { roles: ["Admin"] },
};

const schema: FeatureSchema = {
  featureName: "tasks",
  entities: { task: taskEntity },
  screens: [editScreen, listScreen, restrictedListScreen],
};

function makeDispatcher(overrides: Partial<Dispatcher> = {}): Dispatcher {
  const base = createMockDispatcher({
    query: (async () => ({
      isSuccess: true,
      data: { rows: [], nextCursor: null },
    })) as unknown as Dispatcher["query"],
  });
  return { ...base, ...overrides };
}

describe("KumikoScreen", () => {
  test("unknown qn → not-found placeholder", () => {
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
    fireEvent.click(screen.getByTestId("render-edit-submit"));

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
  // impl lives in renderer-web's RoutedScreen, outside this test — here we
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
    fireEvent.click(screen.getByTestId("render-edit-submit"));

    // Banner zeigt die ÜBERSETZTE version-conflict-Message (kein roher i18nKey)
    // und bietet einen Reload-Button. Gegen das Default-Bundle assertet, damit
    // die Verdrahtung i18nKey → translate → Banner geprüft wird, ohne am
    // konkreten Wording festzukleben.
    await waitFor(() => expect(screen.queryByTestId("render-edit-form-error")).toBeTruthy());
    expect(screen.getByTestId("render-edit-form-error-key").textContent).toBe(
      kumikoDefaultTranslations["en"]?.["errors.versionConflict"] ?? "",
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
    expect(bannerText).toBe(kumikoDefaultTranslations["en"]?.["errors.access.denied"] ?? "");
    expect(bannerText).not.toBe("errors.access.denied");
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
    expect(bannerText).toBe(kumikoDefaultTranslations["en"]?.["errors.access.denied"] ?? "");
    expect(bannerText).not.toBe("errors.access.denied");
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

    const { ToastProvider } = await import("../primitives/toast");
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

    const { ToastProvider } = await import("../primitives/toast");
    const { LocaleProvider, createStaticLocaleResolver, kumikoDefaultTranslations } = await import(
      "@cosmicdrift/kumiko-renderer"
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

    const { NavProvider } = await import("@cosmicdrift/kumiko-renderer");
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
    expect(searchParamUpdates).toEqual([{ taskId: "r1" }]);
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

    const { NavProvider } = await import("@cosmicdrift/kumiko-renderer");
    const { useBrowserNavApi } = await import("../app/nav");
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

    const { NavProvider } = await import("@cosmicdrift/kumiko-renderer");
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
    expect(searchParamUpdates).toEqual([]);
  });

  // JSON-Schema-Fall (window.__KUMIKO_SCHEMA__): Declarative entityId: "id"
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

    const { NavProvider } = await import("@cosmicdrift/kumiko-renderer");
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

    const { NavProvider } = await import("@cosmicdrift/kumiko-renderer");
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

  test("entityList rowActions kind=navigate ohne params: setSearchParams wird NICHT gerufen", async () => {
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
    const { NavProvider } = await import("@cosmicdrift/kumiko-renderer");
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
    expect(searchParamUpdates).toEqual([]);
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

    const { NavProvider } = await import("@cosmicdrift/kumiko-renderer");
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

  // toolbarActions kind:"drawer" (fw#2225): mounts the referenced actionForm
  // in the Drawer primitive instead of navigating — reuses ActionFormBody
  // (no second form renderer), so submit/cancel/field-rendering all go
  // through the same RenderEdit path entityEdit/actionForm already use.
  describe("entityList toolbarActions drawer-kind (fw#2225)", () => {
    const noteForm: ActionFormScreenDefinition = {
      id: "task-note",
      type: "actionForm",
      handler: "tasks:write:task:note",
      fields: { note: { type: "text", required: true } },
      layout: { sections: [{ fields: ["note"] }] },
    };
    const screenWithDrawer: EntityListScreenDefinition = {
      id: "task-list",
      type: "entityList",
      entity: "task",
      columns: ["title"],
      toolbarActions: [
        { kind: "drawer", id: "add-note", label: "actions.addNote", screen: "task-note" },
      ],
    };

    test("Click opens the Drawer with the referenced actionForm's fields", async () => {
      const dispatcher = makeDispatcher({
        query: (async () => ({
          isSuccess: true,
          data: { rows: [{ id: "r1", title: "x", count: 0, done: false }], nextCursor: null },
        })) as unknown as Dispatcher["query"],
      });
      const user = userEvent.setup();
      render(
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen
            schema={{ ...schema, screens: [screenWithDrawer, noteForm] }}
            qn="tasks:screen:task-list"
          />
        </DispatcherProvider>,
      );
      await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());
      expect(screen.queryByTestId("field-note")).toBeNull();

      await user.click(screen.getByTestId("render-list-toolbar-action-add-note"));
      expect(screen.getByTestId("render-edit-form")).toBeTruthy();
      expect(screen.getByTestId("field-note")).toBeTruthy();
    });

    test("Successful submit calls the actionForm's handler, closes the Drawer, and reloads the list", async () => {
      const writeCalls: { type: string; payload: unknown }[] = [];
      let queryCallCount = 0;
      const dispatcher = makeDispatcher({
        query: (async () => {
          queryCallCount += 1;
          return { isSuccess: true, data: { rows: [], nextCursor: null } };
        }) as unknown as Dispatcher["query"],
        write: (async (type: string, payload: unknown) => {
          writeCalls.push({ type, payload });
          return { isSuccess: true, data: {} };
        }) as unknown as Dispatcher["write"],
      });
      const user = userEvent.setup();
      render(
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen
            schema={{ ...schema, screens: [screenWithDrawer, noteForm] }}
            qn="tasks:screen:task-list"
          />
        </DispatcherProvider>,
      );
      await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());
      await user.click(screen.getByTestId("render-list-toolbar-action-add-note"));
      expect(screen.getByTestId("render-edit-form")).toBeTruthy();
      const queryCallsBeforeSubmit = queryCallCount;

      // field-note's testId sits on the Field wrapper (label + errors +
      // control), not the <input> itself — grab the actual control to type
      // into it, same DOM-level approach as other RenderEdit field tests.
      const noteInput = screen.getByTestId("field-note").querySelector("input");
      if (noteInput === null) throw new Error("expected an <input> inside field-note");
      fireEvent.change(noteInput, { target: { value: "hello" } });
      fireEvent.click(screen.getByTestId("render-edit-submit"));

      await waitFor(() => expect(writeCalls.length).toBe(1));
      expect(writeCalls[0]?.type).toBe("tasks:write:task:note");
      await waitFor(() => expect(screen.queryByTestId("render-edit-form")).toBeNull());
      await waitFor(() => expect(queryCallCount).toBeGreaterThan(queryCallsBeforeSubmit));
    });

    // Mirrors kind:"navigate": access is enforced when the target renders,
    // not by hiding the toolbar button — same as a role-gated navigate
    // target still shows its button but denies the destination.
    test("User without access to the target screen: button still triggers, but sees Access denied instead of the form", async () => {
      const restrictedNoteForm: ActionFormScreenDefinition = {
        ...noteForm,
        access: { roles: ["Admin"] },
      };
      const dispatcher = makeDispatcher({
        query: (async () => ({
          isSuccess: true,
          data: { rows: [{ id: "r1", title: "x", count: 0, done: false }], nextCursor: null },
        })) as unknown as Dispatcher["query"],
      });
      const user = userEvent.setup();
      render(
        <DispatcherProvider dispatcher={dispatcher}>
          <UserRolesProvider roles={["Viewer"]}>
            <KumikoScreen
              schema={{ ...schema, screens: [screenWithDrawer, restrictedNoteForm] }}
              qn="tasks:screen:task-list"
            />
          </UserRolesProvider>
        </DispatcherProvider>,
      );
      await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());

      const button = screen.getByTestId("render-list-toolbar-action-add-note");
      await user.click(button);

      expect(screen.getByTestId("kumiko-toolbar-drawer-access-denied")).toBeTruthy();
      expect(screen.queryByTestId("field-note")).toBeNull();
    });
  });

  // Tier 2.7c: Screen-Level filter wird vom Schema in den Query-
  // Payload propagiert. Drei Buckets ("scheduled" / "active" / "done")
  // teilen sich denselben Query-Handler — der Filter unterscheidet
  // welche Rows kommen.
  test("entityList screen-filter: schema.filter landet im query-payload", async () => {
    const queryCalls: { type: string; payload: unknown }[] = [];
    const dispatcher = makeDispatcher({
      query: (async (type: string, payload: unknown) => {
        queryCalls.push({ type, payload });
        return {
          isSuccess: true,
          data: { rows: [], nextCursor: null },
        };
      }) as unknown as Dispatcher["query"],
    });

    const filteredScreen: EntityListScreenDefinition = {
      id: "task-list",
      type: "entityList",
      entity: "task",
      columns: ["title"],
      filter: { field: "status", op: "eq", value: "scheduled" },
    };

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen
          schema={{ ...schema, screens: [filteredScreen] }}
          qn="tasks:screen:task-list"
        />
      </DispatcherProvider>,
    );
    await waitFor(() => expect(queryCalls.length).toBeGreaterThan(0));

    const firstCall = queryCalls[0];
    expect(firstCall?.type).toBe("tasks:query:task:list");
    const payload = firstCall?.payload as { filter?: unknown };
    expect(payload.filter).toEqual({ field: "status", op: "eq", value: "scheduled" });
  });

  // TagFilter drop-in (core edit): a faceted filter on `id` — a base column NOT
  // in entity.fields — must still pass through as an op:"in" id-set so a header-
  // slot control can narrow ANY list to a resolved set of row ids. Before the
  // edit, `id` was silently dropped (only entity.fields facets survived).
  test("entityList faceted id-filter → payload.filters carries an op:'in' id-set", async () => {
    const queryCalls: { type: string; payload: unknown }[] = [];
    const dispatcher = makeDispatcher({
      query: (async (type: string, payload: unknown) => {
        queryCalls.push({ type, payload });
        return { isSuccess: true, data: { rows: [], nextCursor: null } };
      }) as unknown as Dispatcher["query"],
    });
    // useListUrlState reads `<screenId>.f.<field>` (comma-joined) from nav —
    // listScreen.id is "task-list", so this seeds an id-facet of two row ids.
    const navWithIdFilter: NavApi = {
      route: undefined,
      navigate: () => {},
      replace: () => {},
      hrefFor: (t) => ("screenId" in t ? `/${t.screenId}` : ""),
      searchParams: { "task-list.f.id": "r1,r2" },
      setSearchParams: () => {},
    };

    render(
      <NavProvider value={navWithIdFilter}>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen schema={schema} qn="tasks:screen:task-list" />
        </DispatcherProvider>
      </NavProvider>,
    );
    await waitFor(() => expect(queryCalls.length).toBeGreaterThan(0));

    const payload = queryCalls[0]?.payload as { filters?: unknown };
    expect(payload.filters).toEqual([{ field: "id", op: "in", value: ["r1", "r2"] }]);
  });

  // Regression-Guard: Default-Pfad (kein screen.filter) darf KEIN
  // filter-Feld in den queryPayload schicken. Sonst würde Zod-Strict
  // ein leeres `filter: undefined` als 400 abweisen, oder ein
  // "match-none"-Default-Drift entstehen.
  test("entityList ohne screen.filter: queryPayload hat kein filter-Feld", async () => {
    const queryCalls: { type: string; payload: unknown }[] = [];
    const dispatcher = makeDispatcher({
      query: (async (type: string, payload: unknown) => {
        queryCalls.push({ type, payload });
        return {
          isSuccess: true,
          data: { rows: [], nextCursor: null },
        };
      }) as unknown as Dispatcher["query"],
    });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="tasks:screen:task-list" />
      </DispatcherProvider>,
    );
    await waitFor(() => expect(queryCalls.length).toBeGreaterThan(0));

    const payload = queryCalls[0]?.payload as { filter?: unknown };
    expect("filter" in payload).toBe(false);
  });

  test("entityList rowActions visible-filter: hidden Action erscheint nicht im DOM", async () => {
    const dispatcher = makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: {
          rows: [
            { id: "r1", title: "Open", status: "scheduled", count: 0, done: false },
            { id: "r2", title: "Done", status: "completed", count: 0, done: true },
          ],
          nextCursor: null,
        },
      })) as unknown as Dispatcher["query"],
    });

    const screenWithVisible: EntityListScreenDefinition = {
      id: "task-list",
      type: "entityList",
      entity: "task",
      columns: ["title"],
      rowActions: [
        {
          id: "start",
          label: "actions.start",
          handler: "tasks:write:task:start",
          visible: { field: "status", eq: "scheduled" },
        },
      ],
    };

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen
          schema={{ ...schema, screens: [screenWithVisible] }}
          qn="tasks:screen:task-list"
        />
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());

    expect(screen.queryByTestId("row-r1-action-start")).not.toBeNull();
    expect(screen.queryByTestId("row-r2-action-start")).toBeNull();
  });

  // --- actionForm (Tier 2.7d) ---
  // Non-CRUD Write-Handler-driven Form. Schema deklariert handler-QN +
  // inline fields; Renderer baut darauf den selben RenderEdit-Stack
  // wie entityEdit, aber Submit ruft den deklarierten handler statt
  // <feature>:write:<entity>:create.
  test("actionForm: rendert Form-Felder + Submit triggert dispatcher.write(handler, values)", async () => {
    const writeCalls: { type: string; payload: unknown }[] = [];
    const dispatcher = makeDispatcher({
      write: (async (type: string, payload: unknown) => {
        writeCalls.push({ type, payload });
        return { isSuccess: true, data: { id: "new-id" } };
      }) as unknown as Dispatcher["write"],
    });

    const actionScreen: ActionFormScreenDefinition = {
      id: "quick-add",
      type: "actionForm",
      handler: "tasks:write:task:quick-add",
      fields: {
        title: { type: "text", required: true },
        priority: { type: "number", default: 1 },
      },
      layout: { sections: [{ title: "Basics", fields: ["title", "priority"] }] },
    };

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={{ ...schema, screens: [actionScreen] }} qn="tasks:screen:quick-add" />
      </DispatcherProvider>,
    );

    expect(screen.getByTestId("render-edit-form")).toBeTruthy();
    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    expect(titleInput).toBeTruthy();
    fireEvent.change(titleInput, { target: { value: "New Task" } });

    fireEvent.click(screen.getByTestId("render-edit-submit"));
    await waitFor(() => expect(writeCalls.length).toBe(1));
    expect(writeCalls[0]?.type).toBe("tasks:write:task:quick-add");
    // payloadMode="values" — alle Form-Werte landen im Payload, nicht
    // nur die geänderten. Defaults (priority=1) bleiben drin.
    expect(writeCalls[0]?.payload).toEqual({ title: "New Task", priority: 1 });
  });

  test("actionForm mit redirect auf entityList: nach success → navigate ohne entityId (#2419)", async () => {
    const navigateCalls: NavTarget[] = [];
    const dispatcher = makeDispatcher({
      write: (async () => ({
        isSuccess: true,
        data: { id: "x" },
      })) as unknown as Dispatcher["write"],
    });
    const memoryNav = {
      route: { screenId: "quick-add" },
      navigate: (target: NavTarget) => {
        if ("screenId" in target) navigateCalls.push(target);
      },
      replace: () => undefined,
      hrefFor: (t: NavTarget) => ("screenId" in t ? `/${t.screenId}` : ""),
      searchParams: {},
      setSearchParams: () => undefined,
    };
    const actionScreen: ActionFormScreenDefinition = {
      id: "quick-add",
      type: "actionForm",
      handler: "tasks:write:task:quick-add",
      fields: { title: { type: "text", required: true } },
      layout: { sections: [{ title: "x", fields: ["title"] }] },
      redirect: "task-list",
    };

    const { NavProvider } = await import("@cosmicdrift/kumiko-renderer");
    render(
      <NavProvider value={memoryNav}>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen
            schema={{ ...schema, screens: [actionScreen, listScreen] }}
            qn="tasks:screen:quick-add"
          />
        </DispatcherProvider>
      </NavProvider>,
    );

    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "go" } });
    fireEvent.click(screen.getByTestId("render-edit-submit"));
    await waitFor(() => expect(navigateCalls.length).toBe(1));
    // #2419: entityList targets ignore entityId — do not attach a handler id.
    expect(navigateCalls[0]).toEqual({ screenId: "task-list" });
    expect(Object.hasOwn(navigateCalls[0] ?? {}, "entityId")).toBe(false);
  });

  test("actionForm mit Cross-Feature-QN als redirect auf entityList: navigiert per Short-Id ohne entityId (#1946, #2485)", async () => {
    const navigateCalls: NavTarget[] = [];
    const dispatcher = makeDispatcher({
      write: (async () => ({
        isSuccess: true,
        data: { id: "x" },
      })) as unknown as Dispatcher["write"],
    });
    const memoryNav = {
      route: { screenId: "quick-add" },
      navigate: (target: NavTarget) => {
        if ("screenId" in target) navigateCalls.push(target);
      },
      replace: () => undefined,
      hrefFor: (t: NavTarget) => ("screenId" in t ? `/${t.screenId}` : ""),
      searchParams: {},
      setSearchParams: () => undefined,
    };
    const actionScreen: ActionFormScreenDefinition = {
      id: "quick-add",
      type: "actionForm",
      handler: "tasks:write:task:quick-add",
      fields: { title: { type: "text", required: true } },
      layout: { sections: [{ title: "x", fields: ["title"] }] },
      redirect: "statements:screen:statement-upload-list",
    };
    const statementListScreen: EntityListScreenDefinition = {
      id: "statement-upload-list",
      type: "entityList",
      entity: "statement",
      columns: ["title"],
    };
    const statementsSchema: FeatureSchema = {
      featureName: "statements",
      entities: { statement: taskEntity },
      screens: [statementListScreen],
    };
    const tasksSchema: FeatureSchema = { ...schema, screens: [actionScreen, listScreen] };

    const { NavProvider } = await import("@cosmicdrift/kumiko-renderer");
    render(
      <NavProvider value={memoryNav}>
        <AppFeaturesProvider features={[tasksSchema, statementsSchema]}>
          <DispatcherProvider dispatcher={dispatcher}>
            <KumikoScreen schema={tasksSchema} qn="tasks:screen:quick-add" />
          </DispatcherProvider>
        </AppFeaturesProvider>
      </NavProvider>,
    );

    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "go" } });
    fireEvent.click(screen.getByTestId("render-edit-submit"));
    await waitFor(() => expect(navigateCalls.length).toBe(1));
    // #2485: the cross-feature target now resolves (over all mounted
    // features) — it just happens to be an entityList, which never carries
    // an id, same as a same-feature entityList redirect above.
    expect(navigateCalls[0]).toEqual({ screenId: "statement-upload-list" });
    expect(Object.hasOwn(navigateCalls[0] ?? {}, "entityId")).toBe(false);
  });

  test("actionForm mit Cross-Feature-QN als redirect auf entityEdit: hängt entityId an (#2485)", async () => {
    const navigateCalls: NavTarget[] = [];
    const dispatcher = makeDispatcher({
      write: (async () => ({
        isSuccess: true,
        data: { id: "x" },
      })) as unknown as Dispatcher["write"],
    });
    const memoryNav = {
      route: { screenId: "vehicle-start" },
      navigate: (target: NavTarget) => {
        if ("screenId" in target) navigateCalls.push(target);
      },
      replace: () => undefined,
      hrefFor: (t: NavTarget) => ("screenId" in t ? `/${t.screenId}` : ""),
      searchParams: {},
      setSearchParams: () => undefined,
    };
    const decodeScreen: ActionFormScreenDefinition = {
      id: "vehicle-start",
      type: "actionForm",
      handler: "vehicle-vin-decode:write:vehicle:decode",
      fields: { vin: { type: "text", required: true } },
      layout: { sections: [{ title: "x", fields: ["vin"] }] },
      redirect: "vehicles:screen:vehicle-wizard",
    };
    const decodeSchema: FeatureSchema = {
      featureName: "vehicle-vin-decode",
      entities: { task: taskEntity },
      screens: [decodeScreen],
    };
    const wizardScreen: EntityEditScreenDefinition = {
      id: "vehicle-wizard",
      type: "entityEdit",
      entity: "vehicle",
      layout: { sections: [{ title: "x", fields: ["title"] }] },
    };
    const vehiclesSchema: FeatureSchema = {
      featureName: "vehicles",
      entities: { vehicle: taskEntity },
      screens: [wizardScreen],
    };

    const { NavProvider } = await import("@cosmicdrift/kumiko-renderer");
    render(
      <NavProvider value={memoryNav}>
        <AppFeaturesProvider features={[decodeSchema, vehiclesSchema]}>
          <DispatcherProvider dispatcher={dispatcher}>
            <KumikoScreen schema={decodeSchema} qn="vehicle-vin-decode:screen:vehicle-start" />
          </DispatcherProvider>
        </AppFeaturesProvider>
      </NavProvider>,
    );

    const vinInput = screen.getByTestId("field-vin").querySelector("input") as HTMLInputElement;
    fireEvent.change(vinInput, { target: { value: "1HGCM82633A004352" } });
    fireEvent.click(screen.getByTestId("render-edit-submit"));
    await waitFor(() => expect(navigateCalls.length).toBe(1));
    // #2485: redirect crosses a feature boundary (vehicle-vin-decode →
    // vehicles) — the target is only found by searching all mounted
    // features, and it must still carry the created id since it's an
    // entityEdit screen.
    expect(navigateCalls[0]).toEqual({ screenId: "vehicle-wizard", entityId: "x" });
  });

  test("actionForm mit Cross-Feature-QN als redirect: löst den Screen aus der im QN benannten Feature auf, nicht aus dem ersten Id-Treffer (#2485)", async () => {
    const navigateCalls: NavTarget[] = [];
    const dispatcher = makeDispatcher({
      write: (async () => ({
        isSuccess: true,
        data: { id: "x" },
      })) as unknown as Dispatcher["write"],
    });
    const memoryNav = {
      route: { screenId: "vehicle-start" },
      navigate: (target: NavTarget) => {
        if ("screenId" in target) navigateCalls.push(target);
      },
      replace: () => undefined,
      hrefFor: (t: NavTarget) => ("screenId" in t ? `/${t.screenId}` : ""),
      searchParams: {},
      setSearchParams: () => undefined,
    };
    const decodeScreen: ActionFormScreenDefinition = {
      id: "vehicle-start",
      type: "actionForm",
      handler: "vehicle-vin-decode:write:vehicle:decode",
      fields: { vin: { type: "text", required: true } },
      layout: { sections: [{ title: "x", fields: ["vin"] }] },
      redirect: "vehicles:screen:wizard",
    };
    const decodeSchema: FeatureSchema = {
      featureName: "vehicle-vin-decode",
      entities: { task: taskEntity },
      screens: [decodeScreen],
    };
    // Same short id ("wizard") as the real target, but a DIFFERENT feature
    // and a DIFFERENT type (entityList never carries an id) — mounted
    // BEFORE "vehicles" so a naive first-match-by-short-id across all
    // features would pick this one and silently drop the entityId.
    const decoyWizardScreen: EntityListScreenDefinition = {
      id: "wizard",
      type: "entityList",
      entity: "task",
      columns: ["title"],
    };
    const decoySchema: FeatureSchema = {
      featureName: "decoy",
      entities: { task: taskEntity },
      screens: [decoyWizardScreen],
    };
    const wizardScreen: EntityEditScreenDefinition = {
      id: "wizard",
      type: "entityEdit",
      entity: "vehicle",
      layout: { sections: [{ title: "x", fields: ["title"] }] },
    };
    const vehiclesSchema: FeatureSchema = {
      featureName: "vehicles",
      entities: { vehicle: taskEntity },
      screens: [wizardScreen],
    };

    const { NavProvider } = await import("@cosmicdrift/kumiko-renderer");
    render(
      <NavProvider value={memoryNav}>
        <AppFeaturesProvider features={[decodeSchema, decoySchema, vehiclesSchema]}>
          <DispatcherProvider dispatcher={dispatcher}>
            <KumikoScreen schema={decodeSchema} qn="vehicle-vin-decode:screen:vehicle-start" />
          </DispatcherProvider>
        </AppFeaturesProvider>
      </NavProvider>,
    );

    const vinInput = screen.getByTestId("field-vin").querySelector("input") as HTMLInputElement;
    fireEvent.change(vinInput, { target: { value: "1HGCM82633A004352" } });
    fireEvent.click(screen.getByTestId("render-edit-submit"));
    await waitFor(() => expect(navigateCalls.length).toBe(1));
    // The QN names "vehicles" explicitly — the decoy feature's same-id
    // screen (mounted first) must not win just because it comes first.
    expect(navigateCalls[0]).toEqual({ screenId: "wizard", entityId: "x" });
  });

  test("actionForm mit redirect auf entityEdit: hängt entityId an (#2419)", async () => {
    const navigateCalls: NavTarget[] = [];
    const dispatcher = makeDispatcher({
      write: (async () => ({
        isSuccess: true,
        data: { id: "x" },
      })) as unknown as Dispatcher["write"],
    });
    const memoryNav = {
      route: { screenId: "quick-add" },
      navigate: (target: NavTarget) => {
        if ("screenId" in target) navigateCalls.push(target);
      },
      replace: () => undefined,
      hrefFor: (t: NavTarget) => ("screenId" in t ? `/${t.screenId}` : ""),
      searchParams: {},
      setSearchParams: () => undefined,
    };
    const editScreen: EntityEditScreenDefinition = {
      id: "task-edit",
      type: "entityEdit",
      entity: "task",
      layout: { sections: [{ title: "x", fields: ["title"] }] },
    };
    const actionScreen: ActionFormScreenDefinition = {
      id: "quick-add",
      type: "actionForm",
      handler: "tasks:write:task:quick-add",
      fields: { title: { type: "text", required: true } },
      layout: { sections: [{ title: "x", fields: ["title"] }] },
      redirect: "task-edit",
    };

    const { NavProvider } = await import("@cosmicdrift/kumiko-renderer");
    render(
      <NavProvider value={memoryNav}>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen
            schema={{ ...schema, screens: [actionScreen, editScreen, listScreen] }}
            qn="tasks:screen:quick-add"
          />
        </DispatcherProvider>
      </NavProvider>,
    );

    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "go" } });
    fireEvent.click(screen.getByTestId("render-edit-submit"));
    await waitFor(() => expect(navigateCalls.length).toBe(1));
    expect(navigateCalls[0]).toEqual({ screenId: "task-edit", entityId: "x" });
  });

  // #2416: entityEdit-create passes the newly created record's id through to
  // the post-submit navigate as `entityId` (extractCreatedId); actionForm's
  // redirect did the same navigate but never extracted the id. The with-id
  // case is covered by the actionForm redirect success test above (now
  // asserting entityId); this pins the back-compat guarantee.
  test("actionForm mit redirect: Handler-Result ohne id → navigate ohne entityId-Key (Rückwärtskompatibilität, #2416)", async () => {
    const navigateCalls: NavTarget[] = [];
    const dispatcher = makeDispatcher({
      write: (async () => ({
        isSuccess: true,
        data: {},
      })) as unknown as Dispatcher["write"],
    });
    const memoryNav = {
      route: { screenId: "quick-add" },
      navigate: (target: NavTarget) => {
        if ("screenId" in target) navigateCalls.push(target);
      },
      replace: () => undefined,
      hrefFor: (t: NavTarget) => ("screenId" in t ? `/${t.screenId}` : ""),
      searchParams: {},
      setSearchParams: () => undefined,
    };
    const actionScreen: ActionFormScreenDefinition = {
      id: "quick-add",
      type: "actionForm",
      handler: "tasks:write:task:quick-add",
      fields: { title: { type: "text", required: true } },
      layout: { sections: [{ title: "x", fields: ["title"] }] },
      redirect: "task-list",
    };

    const { NavProvider } = await import("@cosmicdrift/kumiko-renderer");
    render(
      <NavProvider value={memoryNav}>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen
            schema={{ ...schema, screens: [actionScreen, listScreen] }}
            qn="tasks:screen:quick-add"
          />
        </DispatcherProvider>
      </NavProvider>,
    );

    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "go" } });
    fireEvent.click(screen.getByTestId("render-edit-submit"));
    await waitFor(() => expect(navigateCalls.length).toBe(1));
    expect(navigateCalls[0]).toEqual({ screenId: "task-list" });
    expect(Object.hasOwn(navigateCalls[0] ?? {}, "entityId")).toBe(false);
  });

  // cancelTarget (Bug-Bash 2026-06-07, Bug 9): redirect erzeugte
  // automatisch einen Abbrechen-Button mit demselben Ziel wie der
  // Submit-Redirect — auf Single-Action-Screens ("Test-Mail senden")
  // semantisch leer. `cancelTarget: false` schaltet ihn ab,
  // `cancelTarget: "<screen>"` entkoppelt ihn vom redirect.
  test("actionForm mit redirect: Abbrechen-Button existiert (historisches Default-Verhalten)", () => {
    const actionScreen: ActionFormScreenDefinition = {
      id: "quick-add",
      type: "actionForm",
      handler: "tasks:write:task:quick-add",
      fields: { title: { type: "text", required: true } },
      layout: { sections: [{ title: "x", fields: ["title"] }] },
      redirect: "task-list",
    };
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <KumikoScreen
          schema={{ ...schema, screens: [actionScreen, listScreen] }}
          qn="tasks:screen:quick-add"
        />
      </DispatcherProvider>,
    );
    expect(screen.getByTestId("render-edit-cancel")).toBeTruthy();
  });

  test("actionForm mit cancelTarget=false: KEIN Abbrechen-Button trotz redirect", () => {
    const actionScreen: ActionFormScreenDefinition = {
      id: "quick-add",
      type: "actionForm",
      handler: "tasks:write:task:quick-add",
      fields: { title: { type: "text", required: true } },
      layout: { sections: [{ title: "x", fields: ["title"] }] },
      redirect: "task-list",
      cancelTarget: false,
    };
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <KumikoScreen
          schema={{ ...schema, screens: [actionScreen, listScreen] }}
          qn="tasks:screen:quick-add"
        />
      </DispatcherProvider>,
    );
    expect(screen.queryByTestId("render-edit-cancel")).toBeNull();
  });

  test("actionForm mit cancelTarget-Screen: Abbrechen navigiert dorthin, auch ohne redirect", async () => {
    const navigateCalls: { screenId: string }[] = [];
    const memoryNav = {
      route: { screenId: "quick-add" },
      navigate: (target: NavTarget) => {
        if ("screenId" in target) navigateCalls.push(target);
      },
      replace: () => undefined,
      hrefFor: (t: NavTarget) => ("screenId" in t ? `/${t.screenId}` : ""),
      searchParams: {},
      setSearchParams: () => undefined,
    };
    const actionScreen: ActionFormScreenDefinition = {
      id: "quick-add",
      type: "actionForm",
      handler: "tasks:write:task:quick-add",
      fields: { title: { type: "text", required: true } },
      layout: { sections: [{ title: "x", fields: ["title"] }] },
      cancelTarget: "task-list",
    };
    const { NavProvider } = await import("@cosmicdrift/kumiko-renderer");
    render(
      <NavProvider value={memoryNav}>
        <DispatcherProvider dispatcher={makeDispatcher()}>
          <KumikoScreen
            schema={{ ...schema, screens: [actionScreen, listScreen] }}
            qn="tasks:screen:quick-add"
          />
        </DispatcherProvider>
      </NavProvider>,
    );
    fireEvent.click(screen.getByTestId("render-edit-cancel"));
    expect(navigateCalls).toEqual([{ screenId: "task-list" }]);
  });

  test("actionForm mit Cross-Feature-QN als cancelTarget: Abbrechen navigiert per Short-Id (#1946)", () => {
    const navigateCalls: { screenId: string }[] = [];
    const memoryNav = {
      route: { screenId: "quick-add" },
      navigate: (target: NavTarget) => {
        if ("screenId" in target) navigateCalls.push(target);
      },
      replace: () => undefined,
      hrefFor: (t: NavTarget) => ("screenId" in t ? `/${t.screenId}` : ""),
      searchParams: {},
      setSearchParams: () => undefined,
    };
    const actionScreen: ActionFormScreenDefinition = {
      id: "quick-add",
      type: "actionForm",
      handler: "tasks:write:task:quick-add",
      fields: { title: { type: "text", required: true } },
      layout: { sections: [{ title: "x", fields: ["title"] }] },
      cancelTarget: "statements:screen:statement-upload-list",
    };
    render(
      <NavProvider value={memoryNav}>
        <DispatcherProvider dispatcher={makeDispatcher()}>
          <KumikoScreen
            schema={{ ...schema, screens: [actionScreen, listScreen] }}
            qn="tasks:screen:quick-add"
          />
        </DispatcherProvider>
      </NavProvider>,
    );
    fireEvent.click(screen.getByTestId("render-edit-cancel"));
    expect(navigateCalls).toEqual([{ screenId: "statement-upload-list" }]);
  });

  // Tier 2.7e-2: URL-Search-Params füllen die actionForm initial values.
  // Use-case: rowAction kind=navigate setzt `?taskId=r1`, das actionForm
  // sieht es beim Mount und pre-fillt das title-Feld.
  test("actionForm initial values: searchParams überschreiben Field-Defaults", async () => {
    const memoryNav = {
      route: { screenId: "approve" },
      navigate: () => undefined,
      replace: () => undefined,
      hrefFor: () => "/x",
      searchParams: { title: "Pre-filled", priority: "9", isDone: "true" },
      setSearchParams: () => undefined,
    };
    const dispatcher = makeDispatcher();
    const actionScreen: ActionFormScreenDefinition = {
      id: "approve",
      type: "actionForm",
      handler: "tasks:write:task:approve",
      fields: {
        title: { type: "text", default: "default-title" },
        priority: { type: "number", default: 1 },
        isDone: { type: "boolean", default: false },
      },
      layout: {
        sections: [{ title: "x", fields: ["title", "priority", "isDone"] }],
      },
    };

    const { NavProvider } = await import("@cosmicdrift/kumiko-renderer");
    render(
      <NavProvider value={memoryNav}>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen schema={{ ...schema, screens: [actionScreen] }} qn="tasks:screen:approve" />
        </DispatcherProvider>
      </NavProvider>,
    );

    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    expect(titleInput.value).toBe("Pre-filled");
    // Number-coercion: "9" → 9. Erfolgreiche Coercion bedeutet das
    // Number-Input zeigt "9" (nicht den default 1).
    const priorityInput = screen
      .getByTestId("field-priority")
      .querySelector("input") as HTMLInputElement;
    expect(priorityInput.value).toBe("9");
  });

  test("actionForm initial values: searchParam mit fehlerhafter Number → Default-Fallback", async () => {
    const memoryNav = {
      route: { screenId: "approve" },
      navigate: () => undefined,
      replace: () => undefined,
      hrefFor: () => "/x",
      searchParams: { priority: "not-a-number" },
      setSearchParams: () => undefined,
    };
    const dispatcher = makeDispatcher();
    const actionScreen: ActionFormScreenDefinition = {
      id: "approve",
      type: "actionForm",
      handler: "tasks:write:task:approve",
      fields: { priority: { type: "number", default: 7 } },
      layout: { sections: [{ title: "x", fields: ["priority"] }] },
    };
    const { NavProvider } = await import("@cosmicdrift/kumiko-renderer");
    render(
      <NavProvider value={memoryNav}>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen schema={{ ...schema, screens: [actionScreen] }} qn="tasks:screen:approve" />
        </DispatcherProvider>
      </NavProvider>,
    );
    const priorityInput = screen
      .getByTestId("field-priority")
      .querySelector("input") as HTMLInputElement;
    expect(priorityInput.value).toBe("7"); // Fallback auf default
  });

  test("actionForm submitLabel: i18n-Key landet auf dem Submit-Button (übersteuert default)", () => {
    const dispatcher = makeDispatcher();
    const actionScreen: ActionFormScreenDefinition = {
      id: "approve",
      type: "actionForm",
      handler: "tasks:write:task:approve",
      fields: { note: { type: "text" } },
      layout: { sections: [{ title: "x", fields: ["note"] }] },
      submitLabel: "actions.approve",
    };

    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={{ ...schema, screens: [actionScreen] }} qn="tasks:screen:approve" />
      </DispatcherProvider>,
    );

    // Test-utils mountet einen identity-translator als Fallback —
    // unbekannte Keys returnen den Key selbst, also rendert "actions.approve".
    expect(screen.getByTestId("render-edit-submit").textContent).toBe("actions.approve");
  });

  test("actionForm ohne redirect: nach success bleibt der User auf der Form (kein navigate)", async () => {
    const navigateCalls: { screenId: string }[] = [];
    const writeCalls: { type: string; payload: unknown }[] = [];
    const dispatcher = makeDispatcher({
      write: (async (type: string, payload: unknown) => {
        writeCalls.push({ type, payload });
        return { isSuccess: true, data: { id: "x" } };
      }) as unknown as Dispatcher["write"],
    });
    const memoryNav = {
      route: { screenId: "quick-add" },
      navigate: (target: NavTarget) => {
        if ("screenId" in target) navigateCalls.push(target);
      },
      replace: () => undefined,
      hrefFor: (t: NavTarget) => ("screenId" in t ? `/${t.screenId}` : ""),
      searchParams: {},
      setSearchParams: () => undefined,
    };
    const actionScreen: ActionFormScreenDefinition = {
      id: "quick-add",
      type: "actionForm",
      handler: "tasks:write:task:quick-add",
      fields: { title: { type: "text", required: true } },
      layout: { sections: [{ title: "x", fields: ["title"] }] },
      // redirect bewusst NICHT gesetzt
    };

    const { NavProvider } = await import("@cosmicdrift/kumiko-renderer");
    render(
      <NavProvider value={memoryNav}>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen
            schema={{ ...schema, screens: [actionScreen] }}
            qn="tasks:screen:quick-add"
          />
        </DispatcherProvider>
      </NavProvider>,
    );

    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "stay" } });
    fireEvent.click(screen.getByTestId("render-edit-submit"));
    // Auf den Write-Call warten — sonst racet der Test gegen den
    // async submit und prüft navigate-Calls bevor handleSubmitted
    // überhaupt gerufen wurde (waitFor auf "render-edit-form" wäre
    // ein no-op weil die Form sowieso schon mounted ist).
    await waitFor(() => expect(writeCalls.length).toBe(1));
    expect(navigateCalls).toEqual([]);
  });

  test("custom screen type without a registered component → error placeholder naming feature + screen (kumiko-framework#2025)", () => {
    const customSchema: FeatureSchema = {
      featureName: "tasks",
      entities: { task: taskEntity },
      screens: [
        {
          id: "dashboard",
          type: "custom",
          renderer: { react: "Dashboard" },
        },
      ],
    };
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <KumikoScreen schema={customSchema} qn="tasks:screen:dashboard" />
      </DispatcherProvider>,
    );
    const placeholder = screen.getByTestId("kumiko-screen-custom-placeholder");
    expect(placeholder.getAttribute("data-variant")).toBe("error");
    expect(placeholder.textContent).toContain("dashboard");
    expect(placeholder.textContent).toContain("tasks");
    expect(placeholder.textContent).toContain("clientFeatures");
  });

  // ------------------------------------------------------------------
  // Auto-Navigate Targets — die drei Hooks im kumiko-screen-Renderer
  // (useNavigateToCreateFor, useNavigateToListAfter, default
  // onRowClick in create-app) ziehen `screenId` aus `schema.screens[].id`
  // und reichen sie an `nav.navigate({ screenId })` durch. Heute hält
  // die Registry SHORT-form-ids in `feature.screens` (siehe
  // packages/framework/src/engine/registry.ts: feature.screens[shortId]
  // = def). Falls dieser Vertrag jemals kippt (Registry stempelt QN-
  // form ein), strippt `lastSegment` defensiv den Prefix — die Tests
  // pinnen beide Pfade.
  // ------------------------------------------------------------------

  test("entityList + Neu-Button → navigiert mit screenId aus Schema", async () => {
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
        data: { rows: [], nextCursor: null },
      })) as unknown as Dispatcher["query"],
    });

    const { NavProvider } = await import("@cosmicdrift/kumiko-renderer");
    render(
      <NavProvider value={memoryNav}>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen schema={schema} qn="tasks:screen:task-list" />
        </DispatcherProvider>
      </NavProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());

    fireEvent.click(screen.getByTestId("render-list-create"));
    await waitFor(() => expect(navigateCalls.length).toBe(1));
    // Short-Form-id, nicht QN — sonst würde der Browser auf
    // "/tasks:screen:task-edit" landen und der Re-Lookup würde
    // doppelt-qualifizieren.
    expect(navigateCalls[0]).toEqual({ screenId: "task-edit" });
  });

  test("Auto-Navigate ist defensiv: schema.screens.id mit Doppel-Punkt-Prefix wird gestrippt", async () => {
    // Defense-in-Depth: falls die Registry irgendwann QN-form-ids in
    // schema.screens stamped, würde useNavigateToCreateFor ohne
    // lastSegment einen QN als screenId weiterreichen → URL doppelt-
    // qualifiziert. Test simuliert diesen hypothetischen Fall.
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
        data: { rows: [], nextCursor: null },
      })) as unknown as Dispatcher["query"],
    });

    // Hypothetische QN-form Edit-id; List bleibt short, sonst findet
    // KumikoScreen seine eigene List-Sicht nicht (qualifyScreenId
    // arbeitet immer feature-prefix-style).
    const editScreenQn: EntityEditScreenDefinition = {
      ...editScreen,
      id: "tasks:screen:task-edit",
    };
    const mixedSchema: FeatureSchema = {
      ...schema,
      screens: [editScreenQn, listScreen],
    };

    const { NavProvider } = await import("@cosmicdrift/kumiko-renderer");
    render(
      <NavProvider value={memoryNav}>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen schema={mixedSchema} qn="tasks:screen:task-list" />
        </DispatcherProvider>
      </NavProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());

    fireEvent.click(screen.getByTestId("render-list-create"));
    await waitFor(() => expect(navigateCalls.length).toBe(1));
    // lastSegment hat den QN-Prefix gestrippt — ohne den Fix würde
    // hier "tasks:screen:task-edit" stehen.
    expect(navigateCalls[0]).toEqual({ screenId: "task-edit" });
  });
});

// --- update-only entityEdit (allowCreate / allowDelete, Wave J) ---
// Lifecycle-Entities (incident: Create über incident:open, kein CRUD-delete)
// brauchen einen Edit-Screen OHNE die CRUD-Annahmen — sonst rendert die
// Liste einen „+ Neu"-Button in einen Create-Branch, dessen Submit gegen
// einen nicht registrierten <entity>:create-Handler liefe, und das
// Update-Form einen Delete-Button gegen einen fehlenden delete-Handler.
describe("KumikoScreen: update-only entityEdit (allowCreate/allowDelete)", () => {
  const updateOnlyEdit: EntityEditScreenDefinition = {
    id: "task-edit",
    type: "entityEdit",
    entity: "task",
    allowCreate: false,
    allowDelete: false,
    layout: { sections: [{ title: "Basics", fields: ["title"] }] },
  };
  const updateOnlySchema: FeatureSchema = {
    featureName: "tasks",
    entities: { task: taskEntity },
    screens: [updateOnlyEdit, listScreen],
  };

  test("allowDelete:false → update-mode rendert keinen Delete-Button", async () => {
    const dispatcher = makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { id: "task-1", version: 3, title: "loaded", count: 0, done: false },
      })) as unknown as Dispatcher["query"],
    });
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={updateOnlySchema} qn="tasks:screen:task-edit" entityId="task-1" />
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());
    expect(screen.getByTestId("render-edit-form")).toBeTruthy();
    expect(screen.queryByTestId("render-edit-delete")).toBeNull();
  });

  test("allowCreate:false → entityList rendert keinen automatischen + Neu-Button", async () => {
    const dispatcher = makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { rows: [], nextCursor: null },
      })) as unknown as Dispatcher["query"],
    });
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={updateOnlySchema} qn="tasks:screen:task-list" />
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());
    expect(screen.queryByTestId("render-list-create")).toBeNull();
  });

  test("allowCreate:false → Aufruf ohne entityId zeigt Fehler-Banner statt Create-Form", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <KumikoScreen schema={updateOnlySchema} qn="tasks:screen:task-edit" />
      </DispatcherProvider>,
    );
    expect(screen.getByTestId("kumiko-screen-create-disabled")).toBeTruthy();
    expect(screen.queryByTestId("render-edit-form")).toBeNull();
  });
});

// --- singleton entityEdit (fw#1941) ---
// Singleton entities (exactly one record per tenant) have no nav path
// that supplies an entityId. `singleton: true` resolves the existing
// record via list(limit:1) before deciding create vs update.
// KumikoScreen: singleton entityEdit — moved to
// kumiko-screen-singleton-entity-edit.test.tsx (#2495): its create->update
// submit test needs its own isolated bun test process (#457 shared
// single-process happy-dom event-delegation corruption).

// --- actionForm extension-section (Wave J: Incident-Update-Timeline) ---
// actionForm hat keinen record — Extension-Sections bekommen stattdessen
// die initialen Form-Values (inkl. searchParams-Prefill) als initialValues.
// Ohne den Durchgriff bliebe eine Kontext-Section (z.B. Update-Timeline,
// die ?incidentId liest) blind.
describe("KumikoScreen: actionForm extension-section", () => {
  test("extension-section erhält initialValues inkl. searchParams-Prefill", async () => {
    const actionScreen: ActionFormScreenDefinition = {
      id: "post-update",
      type: "actionForm",
      handler: "tasks:write:task:post-update",
      fields: {
        incidentId: { type: "text", required: true },
        body: { type: "text", required: true },
      },
      layout: {
        sections: [
          {
            kind: "extension",
            title: "Timeline",
            component: { react: { __component: "UpdateTimeline" } },
          },
          { title: "Update", fields: ["incidentId", "body"] },
        ],
      },
    };
    const UpdateTimeline = ({
      initialValues,
    }: {
      initialValues?: Readonly<Record<string, unknown>>;
    }) => (
      <div data-testid="update-timeline">{String(initialValues?.["incidentId"] ?? "(none)")}</div>
    );
    const memoryNav = {
      route: { screenId: "post-update" },
      navigate: () => undefined,
      replace: () => undefined,
      hrefFor: (t: NavTarget) => ("screenId" in t ? `/${t.screenId}` : ""),
      searchParams: { incidentId: "inc-7" },
      setSearchParams: () => undefined,
    };
    const { NavProvider } = await import("@cosmicdrift/kumiko-renderer");
    render(
      <NavProvider value={memoryNav}>
        <DispatcherProvider dispatcher={makeDispatcher()}>
          <ExtensionSectionsProvider value={{ UpdateTimeline }}>
            <KumikoScreen
              schema={{ ...schema, screens: [actionScreen] }}
              qn="tasks:screen:post-update"
            />
          </ExtensionSectionsProvider>
        </DispatcherProvider>
      </NavProvider>,
    );
    expect(screen.getByTestId("update-timeline").textContent).toBe("inc-7");
  });
});

// --- entityEdit header actions (fw entityEdit-actions) ---
// EntityEditScreenDefinition.actions mirrors ProjectionDetailScreenDefinition.
// actions — same RenderEdit `actions` prop, same icon-only collapse rule
// (shouldRenderActionsIconOnly: >2 actions, every one resolves an icon).
describe("KumikoScreen: entityEdit header actions", () => {
  const threeActionsScreen: EntityEditScreenDefinition = {
    id: "task-edit-actions-3",
    type: "entityEdit",
    entity: "task",
    layout: { sections: [{ title: "Basics", fields: ["title"] }] },
    // ids match ACTION_ICON_BY_ID entries (publish/archive/duplicate) so
    // every action resolves an icon without an explicit `icon` field.
    actions: [
      { id: "publish", label: "Publish", handler: "tasks:write:task:publish" },
      { id: "archive", label: "Archive", handler: "tasks:write:task:archive" },
      { id: "duplicate", label: "Duplicate", handler: "tasks:write:task:duplicate" },
    ],
  };
  const twoActionsScreen: EntityEditScreenDefinition = {
    ...threeActionsScreen,
    id: "task-edit-actions-2",
    actions: threeActionsScreen.actions?.slice(0, 2),
  };
  const actionsSchema: FeatureSchema = {
    featureName: "tasks",
    entities: { task: taskEntity },
    screens: [threeActionsScreen, twoActionsScreen],
  };
  const detailDispatcher = () =>
    makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { id: "task-1", version: 1, title: "loaded", count: 0, done: false },
      })) as unknown as Dispatcher["query"],
    });

  test("update-mode mit drei Header-Actions kollabiert auf Icon-only mit ariaLabel", async () => {
    render(
      <DispatcherProvider dispatcher={detailDispatcher()}>
        <KumikoScreen
          schema={actionsSchema}
          qn="tasks:screen:task-edit-actions-3"
          entityId="task-1"
        />
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());

    const cases = [
      ["publish", "Publish"],
      ["archive", "Archive"],
      ["duplicate", "Duplicate"],
    ] as const;
    for (const [id, label] of cases) {
      const button = screen.getByTestId(`render-edit-action-${id}`);
      expect(button.textContent).toBe("");
      expect(button.getAttribute("aria-label")).toBe(label);
    }
  });

  test("update-mode mit zwei Header-Actions zeigt weiterhin sichtbaren Text", async () => {
    render(
      <DispatcherProvider dispatcher={detailDispatcher()}>
        <KumikoScreen
          schema={actionsSchema}
          qn="tasks:screen:task-edit-actions-2"
          entityId="task-1"
        />
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());

    expect(screen.getByTestId("render-edit-action-publish").textContent).toBe("Publish");
    expect(screen.getByTestId("render-edit-action-archive").textContent).toBe("Archive");
  });

  test("update-mode mit drei Header-Actions kollabiert auch den Copy-Link-Button auf Icon-only mit ariaLabel", async () => {
    render(
      <DispatcherProvider dispatcher={detailDispatcher()}>
        <KumikoScreen
          schema={actionsSchema}
          qn="tasks:screen:task-edit-actions-3"
          entityId="task-1"
          onCopyLink={() => Promise.resolve()}
        />
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());

    const button = screen.getByTestId("render-edit-copy-link");
    expect(button.textContent).toBe("");
    expect(button.getAttribute("aria-label")).toBe("Copy link");
  });

  // Design decision (fw entityEdit-actions): actions target an EXISTING
  // record (publish/archive/duplicate and friends) — create mode has none
  // yet, so EntityEditCreateBody never builds a headerActions prop at all.
  test("create-mode (kein entityId) rendert keine Header-Actions", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <KumikoScreen schema={actionsSchema} qn="tasks:screen:task-edit-actions-3" />
      </DispatcherProvider>,
    );
    expect(screen.getByTestId("render-edit-form")).toBeTruthy();
    expect(screen.queryByTestId("render-edit-action-publish")).toBeNull();
    expect(screen.queryByTestId("render-edit-action-archive")).toBeNull();
    expect(screen.queryByTestId("render-edit-action-duplicate")).toBeNull();
  });
});

// --- entityList status cells + row actions (fw#2579, fw#2580) ---
// Both are leftovers from #2575: the tone heuristic and the icon-only
// collapse existed, but neither reached a list cell. These render the real
// entityList pipeline (KumikoScreen -> EntityListBody -> RenderList ->
// DataTable) against the real web primitives.
describe("KumikoScreen: entityList cell rendering", () => {
  const orderEntity = {
    fields: {
      title: { type: "text", required: true },
      status: { type: "select", options: ["active", "unmapped-value", "constructor"] },
    },
  } as unknown as EntityDefinition;

  const statusListScreen: EntityListScreenDefinition = {
    id: "order-list",
    type: "entityList",
    entity: "order",
    columns: ["title", "status"],
  };

  // publish/archive/duplicate all resolve an icon from their id
  // (ACTION_ICON_BY_ID), which is what arms the icon-only collapse.
  const rowActionListScreen: EntityListScreenDefinition = {
    id: "order-list-actions",
    type: "entityList",
    entity: "order",
    columns: ["title"],
    rowActions: [
      { id: "publish", label: "Publish", handler: "orders:write:order:publish" },
      { id: "archive", label: "Archive", handler: "orders:write:order:archive" },
      { id: "duplicate", label: "Duplicate", handler: "orders:write:order:duplicate" },
    ],
  };

  // "review" has no icon in ACTION_ICON_BY_ID, so this group must stay on
  // the adaptive default (kebab) instead of collapsing.
  const mixedActionListScreen: EntityListScreenDefinition = {
    id: "order-list-mixed",
    type: "entityList",
    entity: "order",
    columns: ["title"],
    rowActions: [
      { id: "publish", label: "Publish", handler: "orders:write:order:publish" },
      { id: "archive", label: "Archive", handler: "orders:write:order:archive" },
      { id: "review", label: "Review", handler: "orders:write:order:review" },
    ],
  };

  // projectionList reaches the same RenderList/DataTable path, so the collapse
  // has to hold there too.
  const projectionActionListScreen: ProjectionListScreenDefinition = {
    id: "order-projection-actions",
    type: "projectionList",
    query: "orders:query:order:list",
    columns: [{ field: "title", label: "Title" }],
    rowActions: [
      {
        kind: "writeHandler",
        id: "publish",
        label: "Publish",
        handler: "orders:write:order:publish",
      },
      {
        kind: "writeHandler",
        id: "archive",
        label: "Archive",
        handler: "orders:write:order:archive",
      },
      {
        kind: "writeHandler",
        id: "duplicate",
        label: "Duplicate",
        handler: "orders:write:order:duplicate",
      },
    ],
  };

  const orderSchema: FeatureSchema = {
    featureName: "orders",
    entities: { order: orderEntity },
    screens: [
      statusListScreen,
      rowActionListScreen,
      mixedActionListScreen,
      projectionActionListScreen,
    ],
  };

  function orderDispatcher(rows: readonly Record<string, unknown>[]): Dispatcher {
    return makeDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { rows, nextCursor: null },
      })) as unknown as Dispatcher["query"],
    });
  }

  async function renderOrderList(
    qn: string,
    rows: readonly Record<string, unknown>[],
  ): Promise<void> {
    render(
      <DispatcherProvider dispatcher={orderDispatcher(rows)}>
        <KumikoScreen schema={orderSchema} qn={qn} />
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("kumiko-screen-loading")).toBeNull());
  }

  test("a known status value renders a toned badge, not the muted default (#2579)", async () => {
    await renderOrderList("orders:screen:order-list", [
      { id: "r1", title: "First", status: "active" },
    ]);

    const badge = screen.getByTestId("cell-r1-status").firstElementChild;
    expect(badge?.className).toContain("text-status-ok");
    expect(badge?.className).not.toContain("text-muted-foreground");
    expect(badge?.textContent).toBe("Active");
  });

  test("an unmapped select value keeps the neutral pill (#2579)", async () => {
    await renderOrderList("orders:screen:order-list", [
      { id: "r1", title: "First", status: "unmapped-value" },
    ]);

    const badge = screen.getByTestId("cell-r1-status").firstElementChild;
    expect(badge?.className).toContain("text-muted-foreground");
    expect(badge?.className).not.toContain("text-status-ok");
  });

  test("an Object.prototype key is not mistaken for a tone (#2579)", async () => {
    await renderOrderList("orders:screen:order-list", [
      { id: "r1", title: "First", status: "constructor" },
    ]);

    const badge = screen.getByTestId("cell-r1-status").firstElementChild;
    expect(badge?.className).toContain("text-muted-foreground");
  });

  test("three icon-bearing row actions collapse to icon-only buttons (#2580)", async () => {
    await renderOrderList("orders:screen:order-list-actions", [{ id: "r1", title: "First" }]);

    expect(screen.queryByTestId("row-r1-actions-menu")).toBeNull();
    for (const [id, label] of [
      ["publish", "Publish"],
      ["archive", "Archive"],
      ["duplicate", "Duplicate"],
    ] as const) {
      const button = screen.getByTestId(`row-r1-action-${id}`);
      expect(button.textContent).toBe("");
      expect(button.getAttribute("aria-label")).toBe(label);
    }
  });

  test("projectionList row actions collapse the same way (#2580)", async () => {
    await renderOrderList("orders:screen:order-projection-actions", [{ id: "r1", title: "First" }]);

    expect(screen.queryByTestId("row-r1-actions-menu")).toBeNull();
    for (const [id, label] of [
      ["publish", "Publish"],
      ["archive", "Archive"],
      ["duplicate", "Duplicate"],
    ] as const) {
      const button = screen.getByTestId(`row-r1-action-${id}`);
      expect(button.textContent).toBe("");
      expect(button.getAttribute("aria-label")).toBe(label);
    }
  });

  test("a row-action group with an icon-less member stays on the kebab (#2580)", async () => {
    await renderOrderList("orders:screen:order-list-mixed", [{ id: "r1", title: "First" }]);

    expect(screen.queryByTestId("row-r1-actions-menu")).not.toBeNull();
    expect(screen.queryByTestId("row-r1-action-publish")).toBeNull();
  });
});
