import { describe, expect, test } from "bun:test";
import type {
  ActionFormScreenDefinition,
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { type ReactNode, useState } from "react";
import { extractIdField } from "../../components/reference-create-dialog.tsx";
import type { Dispatcher } from "../../headless/index.ts";
import type { FeatureSchema, NavTarget } from "../../index.ts";
import {
  AppFeaturesProvider,
  DispatcherProvider,
  ExtensionSectionsProvider,
  KumikoScreen,
  NavProvider,
  useNavigateWithInitialValues,
} from "../../index.ts";
import {
  clickSubmitOnceEnabled,
  editScreen,
  listScreen,
  schema,
} from "./_kumiko-screen-helpers.tsx";
import { fireEvent, makeDispatcher, render, screen, taskEntity, waitFor } from "./test-utils.tsx";

describe("KumikoScreen", () => {
  // --- actionForm (tier 2.7d) ---
  // Non-CRUD form driven by a write handler. The schema declares a handler QN +
  // inline fields; the renderer builds the same RenderEdit stack as for
  // entityEdit on top of it, but submit calls the declared handler instead of
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

    await clickSubmitOnceEnabled();
    await waitFor(() => expect(writeCalls.length).toBe(1));
    expect(writeCalls[0]?.type).toBe("tasks:write:task:quick-add");
    // payloadMode="values": all form values land in the payload, not only the
    // changed ones. Defaults (priority=1) stay in.
    expect(writeCalls[0]?.payload).toEqual({ title: "New Task", priority: 1 });
  });

  // slots.header/footer on entityEdit are shared through action-form-shim's
  // synthesizeActionFormScreen — an actionForm mounts them the same way.
  test("actionForm: slots.header and slots.footer both render (fw#2853)", async () => {
    const TopBanner = () => <div data-testid="action-form-header-slot">top banner</div>;
    const BottomAction = () => <button type="button" data-testid="action-form-footer-slot" />;

    const actionScreen: ActionFormScreenDefinition = {
      id: "quick-add-slots",
      type: "actionForm",
      handler: "tasks:write:task:quick-add",
      fields: { title: { type: "text", required: true } },
      layout: { sections: [{ title: "Basics", fields: ["title"] }] },
      slots: {
        header: { react: { __component: "TopBanner" } },
        footer: { react: { __component: "BottomAction" } },
      },
    };

    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <ExtensionSectionsProvider value={{ TopBanner, BottomAction }}>
          <KumikoScreen
            schema={{ ...schema, screens: [actionScreen] }}
            qn="tasks:screen:quick-add-slots"
          />
        </ExtensionSectionsProvider>
      </DispatcherProvider>,
    );

    expect(screen.getByTestId("action-form-header-slot")).toBeTruthy();
    expect(screen.getByTestId("action-form-footer-slot")).toBeTruthy();
    expect(screen.getByTestId("render-edit-submit")).toBeTruthy();
  });

  // actionForm submitStyle reaches the submit button.
  test("actionForm submitStyle='danger': submit button renders destructive variant", async () => {
    const dispatcher = makeDispatcher({
      write: (async () => ({
        isSuccess: true,
        data: { id: "new-id" },
      })) as unknown as Dispatcher["write"],
    });

    const actionScreen: ActionFormScreenDefinition = {
      id: "quick-add",
      type: "actionForm",
      handler: "tasks:write:task:quick-add",
      submitStyle: "danger",
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

    expect(screen.getByTestId("render-edit-submit").getAttribute("data-variant")).toBe(
      "destructive",
    );
  });

  test("actionForm ohne submitStyle: submit button renders default variant", async () => {
    const dispatcher = makeDispatcher({
      write: (async () => ({
        isSuccess: true,
        data: { id: "new-id" },
      })) as unknown as Dispatcher["write"],
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

    expect(screen.getByTestId("render-edit-submit").getAttribute("data-variant")).toBe("default");
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

    const { NavProvider } = await import("../../index.ts");
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
    await clickSubmitOnceEnabled();
    await waitFor(() => expect(navigateCalls.length).toBe(1));
    // entityList targets ignore entityId — do not attach a handler id.
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

    const { NavProvider } = await import("../../index.ts");
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
    await clickSubmitOnceEnabled();
    await waitFor(() => expect(navigateCalls.length).toBe(1));
    // The cross-feature target now resolves (over all mounted
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

    const { NavProvider } = await import("../../index.ts");
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
    await clickSubmitOnceEnabled();
    await waitFor(() => expect(navigateCalls.length).toBe(1));
    // Redirect crosses a feature boundary (vehicle-vin-decode →
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

    const { NavProvider } = await import("../../index.ts");
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
    await clickSubmitOnceEnabled();
    await waitFor(() => expect(navigateCalls.length).toBe(1));
    // The QN names "vehicles" explicitly — the decoy feature's same-id
    // screen (mounted first) must not win just because it comes first.
    expect(navigateCalls[0]).toEqual({ screenId: "wizard", entityId: "x" });
  });

  test("actionForm mit Cross-Feature-QN: ein eigener Screen mit gleicher Short-Id schattet das im QN benannte Ziel nicht ab (#2486)", async () => {
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
    // The redirecting feature's OWN screen shares the short id of the target.
    const ownWizardScreen: EntityListScreenDefinition = {
      id: "wizard",
      type: "entityList",
      entity: "task",
      columns: ["title"],
    };
    const decodeSchema: FeatureSchema = {
      featureName: "vehicle-vin-decode",
      entities: { task: taskEntity },
      screens: [decodeScreen, ownWizardScreen],
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

    const { NavProvider } = await import("../../index.ts");
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
    await clickSubmitOnceEnabled();
    await waitFor(() => expect(navigateCalls.length).toBe(1));
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

    const { NavProvider } = await import("../../index.ts");
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
    await clickSubmitOnceEnabled();
    await waitFor(() => expect(navigateCalls.length).toBe(1));
    expect(navigateCalls[0]).toEqual({ screenId: "task-edit", entityId: "x" });
  });

  // A handler that writes a child record reports the child's id, but
  // the redirect target is the parent's detail screen — `idFrom` names the
  // payload field the navigation id comes from, so the handler keeps
  // reporting what it actually wrote.
  test("actionForm mit redirect-Objekt + idFrom: navigiert mit der Eltern-ID statt data.id (#2670)", async () => {
    const navigateCalls: NavTarget[] = [];
    const dispatcher = makeDispatcher({
      write: (async () => ({
        isSuccess: true,
        data: { id: "child", leaseId: "parent" },
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
      redirect: { screen: "task-edit", idFrom: "leaseId" },
    };

    const { NavProvider } = await import("../../index.ts");
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
    await clickSubmitOnceEnabled();
    await waitFor(() => expect(navigateCalls.length).toBe(1));
    expect(navigateCalls[0]).toEqual({ screenId: "task-edit", entityId: "parent" });
  });

  test("actionForm mit redirect-Objekt + idFrom, das im Payload fehlt: navigiert ohne entityId, nicht mit data.id", async () => {
    const navigateCalls: NavTarget[] = [];
    const dispatcher = makeDispatcher({
      write: (async () => ({
        isSuccess: true,
        data: { id: "child" },
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
      redirect: { screen: "task-edit", idFrom: "leaseId" },
    };

    const { NavProvider } = await import("../../index.ts");
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
    await clickSubmitOnceEnabled();
    await waitFor(() => expect(navigateCalls.length).toBe(1));
    expect(navigateCalls[0]).toEqual({ screenId: "task-edit" });
  });

  describe("extractIdField", () => {
    test("liefert den String-Wert eigener Felder", () => {
      expect(extractIdField({ leaseId: "x" }, "leaseId")).toBe("x");
    });

    test("fehlendes Feld, Nicht-String und Nicht-Objekt → undefined", () => {
      expect(extractIdField({}, "leaseId")).toBeUndefined();
      expect(extractIdField({ leaseId: 5 }, "leaseId")).toBeUndefined();
      expect(extractIdField(null, "leaseId")).toBeUndefined();
      expect(extractIdField("leaseId", "leaseId")).toBeUndefined();
    });

    test("Prototyp-Schlüssel lösen nicht auf (own-property-Guard)", () => {
      expect(extractIdField({}, "constructor")).toBeUndefined();
      expect(extractIdField(Object.create({ leaseId: "x" }), "leaseId")).toBeUndefined();
    });
  });

  test("actionForm mit blankem String-redirect: navigiert weiter mit data.id, nicht mit einem anderen Payload-Feld (#2670)", async () => {
    const navigateCalls: NavTarget[] = [];
    const dispatcher = makeDispatcher({
      write: (async () => ({
        isSuccess: true,
        data: { id: "child", leaseId: "parent" },
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

    const { NavProvider } = await import("../../index.ts");
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
    await clickSubmitOnceEnabled();
    await waitFor(() => expect(navigateCalls.length).toBe(1));
    expect(navigateCalls[0]).toEqual({ screenId: "task-edit", entityId: "child" });
  });

  // entityEdit-create passes the newly created record's id through to
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

    const { NavProvider } = await import("../../index.ts");
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
    await clickSubmitOnceEnabled();
    await waitFor(() => expect(navigateCalls.length).toBe(1));
    expect(navigateCalls[0]).toEqual({ screenId: "task-list" });
    expect(Object.hasOwn(navigateCalls[0] ?? {}, "entityId")).toBe(false);
  });

  // cancelTarget (bug bash 2026-06-07, bug 9): redirect automatically created
  // a cancel button with the same target as the submit redirect — semantically
  // empty on single-action screens ("send test mail"). `cancelTarget: false`
  // switches it off, `cancelTarget: "<screen>"` decouples it from the redirect.
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
    const { NavProvider } = await import("../../index.ts");
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

  // URL search params fill the actionForm initial values.
  // Use case: a rowAction kind=navigate sets `?taskId=r1`, the actionForm
  // sees it on mount and prefills the title field.
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
      urlPrefillFields: ["title", "priority", "isDone"],
    };

    const { NavProvider } = await import("../../index.ts");
    render(
      <NavProvider value={memoryNav}>
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen schema={{ ...schema, screens: [actionScreen] }} qn="tasks:screen:approve" />
        </DispatcherProvider>
      </NavProvider>,
    );

    const titleInput = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    expect(titleInput.value).toBe("Pre-filled");
    // Number coercion: "9" -> 9. Successful coercion means the number input
    // shows "9" (not the default 1).
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
      urlPrefillFields: ["priority"],
    };
    const { NavProvider } = await import("../../index.ts");
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
    expect(priorityInput.value).toBe("7"); // Fallback to the default
  });

  const payoutScreen: ActionFormScreenDefinition = {
    id: "payout",
    type: "actionForm",
    handler: "tasks:write:task:payout",
    fields: {
      title: { type: "text", default: "default-title" },
      iban: { type: "text", default: "own-iban" },
      secret: { type: "text", sensitive: true },
    },
    layout: { sections: [{ title: "x", fields: ["title", "iban", "secret"] }] },
    urlPrefillFields: ["title", "secret"],
  };

  function inputValue(fieldName: string): string {
    const input = screen.getByTestId(`field-${fieldName}`).querySelector("input");
    if (input === null) throw new Error(`expected an <input> inside field-${fieldName}`);
    return input.value;
  }

  test("actionForm: a crafted link prefills only urlPrefillFields, never a sensitive one", async () => {
    const memoryNav = {
      route: { screenId: "payout" },
      navigate: () => undefined,
      replace: () => undefined,
      hrefFor: () => "/x",
      searchParams: { title: "declared", iban: "attacker-iban", secret: "leak" },
      setSearchParams: () => undefined,
    };
    const { NavProvider } = await import("../../index.ts");
    render(
      <NavProvider value={memoryNav}>
        <DispatcherProvider dispatcher={makeDispatcher()}>
          <KumikoScreen schema={{ ...schema, screens: [payoutScreen] }} qn="tasks:screen:payout" />
        </DispatcherProvider>
      </NavProvider>,
    );
    expect(inputValue("title")).toBe("declared");
    expect(inputValue("iban")).toBe("own-iban");
    expect(inputValue("secret")).toBe("");
  });

  test("actionForm: useNavigateWithInitialValues hands values over without touching the query string", async () => {
    const searchParamWrites: unknown[] = [];
    function Harness(): ReactNode {
      const [route, setRoute] = useState<{ screenId: string }>({ screenId: "home" });
      const nav = {
        route,
        navigate: (target: NavTarget) => {
          if ("screenId" in target) setRoute({ screenId: target.screenId });
        },
        replace: () => undefined,
        hrefFor: () => "/x",
        searchParams: {},
        setSearchParams: (u: Record<string, string | null>) => searchParamWrites.push(u),
      };
      return (
        <NavProvider value={nav}>
          {route.screenId === "payout" ? (
            <KumikoScreen
              schema={{ ...schema, screens: [payoutScreen] }}
              qn="tasks:screen:payout"
            />
          ) : (
            <OpenPayout />
          )}
        </NavProvider>
      );
    }
    function OpenPayout(): ReactNode {
      const navigateWithInitialValues = useNavigateWithInitialValues();
      return (
        <button
          type="button"
          data-testid="open-payout"
          onClick={() =>
            navigateWithInitialValues(
              { screenId: "payout" },
              { iban: "DE-from-agent", secret: "leak" },
            )
          }
        />
      );
    }
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <Harness />
      </DispatcherProvider>,
    );
    fireEvent.click(screen.getByTestId("open-payout"));
    await waitFor(() => expect(screen.getByTestId("field-iban")).toBeTruthy());
    expect(inputValue("iban")).toBe("DE-from-agent");
    expect(inputValue("secret")).toBe("");
    expect(searchParamWrites).toEqual([]);
  });

  test("actionForm: the same values as URL params do not prefill fields outside urlPrefillFields", async () => {
    const memoryNav = {
      route: { screenId: "payout" },
      navigate: () => undefined,
      replace: () => undefined,
      hrefFor: () => "/x",
      searchParams: { iban: "DE-from-agent", agentPrefill: "1" },
      setSearchParams: () => undefined,
    };
    const { NavProvider } = await import("../../index.ts");
    render(
      <NavProvider value={memoryNav}>
        <DispatcherProvider dispatcher={makeDispatcher()}>
          <KumikoScreen schema={{ ...schema, screens: [payoutScreen] }} qn="tasks:screen:payout" />
        </DispatcherProvider>
      </NavProvider>,
    );
    expect(inputValue("iban")).toBe("own-iban");
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

    // test-utils mounts an identity translator as fallback:
    // unknown keys return the key itself, so "actions.approve" is rendered.
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

    const { NavProvider } = await import("../../index.ts");
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
    await clickSubmitOnceEnabled();
    // Wait for the write call, otherwise the test races against the async
    // submit and checks navigate calls before handleSubmitted was even called
    // (waitFor on "render-edit-form" would be a no-op because the form is
    // already mounted anyway).
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
  // Auto-navigate targets: the three hooks in the kumiko-screen renderer
  // (useNavigateToCreateFor, useNavigateToListAfter, default
  // onRowClick in create-app) take `screenId` from `schema.screens[].id`
  // and pass it on to `nav.navigate({ screenId })`. Today the registry
  // holds SHORT-form ids in `feature.screens` (see
  // packages/framework/src/engine/registry.ts: feature.screens[shortId]
  // = def). Should this contract ever flip (registry stamps QN-form),
  // `lastSegment` defensively strips the prefix; the tests pin both paths.
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

    const { NavProvider } = await import("../../index.ts");
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
    // Short-form id, not QN, otherwise the browser would land on
    // "/tasks:screen:task-edit" and the re-lookup would double-qualify.
    expect(navigateCalls[0]).toEqual({ screenId: "task-edit" });
  });

  test("Auto-Navigate ist defensiv: schema.screens.id mit Doppel-Punkt-Prefix wird gestrippt", async () => {
    // Defense in depth: should the registry ever stamp QN-form ids into
    // schema.screens, useNavigateToCreateFor without lastSegment would pass a
    // QN on as screenId -> URL double-qualified. The test simulates this
    // hypothetical case.
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

    // Hypothetical QN-form edit id; the list stays short, otherwise
    // KumikoScreen cannot find its own list view (qualifyScreenId always
    // works feature-prefix style).
    const editScreenQn: EntityEditScreenDefinition = {
      ...editScreen,
      id: "tasks:screen:task-edit",
    };
    const mixedSchema: FeatureSchema = {
      ...schema,
      screens: [editScreenQn, listScreen],
    };

    const { NavProvider } = await import("../../index.ts");
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
    // lastSegment stripped the QN prefix; without the fix
    // "tasks:screen:task-edit" would be here.
    expect(navigateCalls[0]).toEqual({ screenId: "task-edit" });
  });
});

// --- singleton entityEdit ---
// Singleton entities (exactly one record per tenant) have no nav path
// that supplies an entityId. `singleton: true` resolves the existing
// record via list(limit:1) before deciding create vs update.
// KumikoScreen: singleton entityEdit — moved to
// kumiko-screen-singleton-entity-edit.test.tsx: its create->update
// submit test needs its own isolated bun test process (shared
// single-process happy-dom event-delegation corruption).

// --- actionForm extension-section (wave J: incident update timeline) ---
// actionForm has no record; extension sections get the initial form values
// (incl. searchParams prefill) as initialValues instead.
// Without this pass-through a context section (e.g. update timeline that
// reads ?incidentId) would stay blind.
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
      urlPrefillFields: ["incidentId"],
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
    const { NavProvider } = await import("../../index.ts");
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
