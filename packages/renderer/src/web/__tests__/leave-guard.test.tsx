import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
  ProjectionDetailScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { ReactNode } from "react";
import type { Dispatcher } from "../../headless/index.ts";
import {
  DispatcherProvider,
  type ExtensionSectionProps,
  ExtensionSectionsProvider,
  type FeatureSchema,
  KumikoScreen,
  LeaveGuardDialog,
  NavProvider,
  navigateWithReturnTo,
  RenderEdit,
  useExtensionFormSubmit,
  useNav,
} from "../../index.ts";
import { KumikoLink, useBrowserNavApi } from "../app/nav.tsx";
import { act, createMockDispatcher, fireEvent, render, screen, waitFor } from "./test-utils.tsx";

const taskEntity = {
  fields: { title: { type: "text", required: true } },
} as unknown as EntityDefinition;

const taskScreen: EntityEditScreenDefinition = {
  id: "tasks:screen:task-edit",
  type: "entityEdit",
  entity: "task",
  layout: { sections: [{ title: "Basics", columns: 1, fields: ["title"] }] },
};

type TaskValues = { title: string };

function BrowserNav({ children }: { readonly children: ReactNode }): ReactNode {
  return <NavProvider value={useBrowserNavApi()}>{children}</NavProvider>;
}

function GoToListButton(): ReactNode {
  const nav = useNav();
  return (
    <button type="button" data-testid="go-list" onClick={() => nav.navigate({ screenId: "list" })}>
      go
    </button>
  );
}

function Harness({
  dispatcher,
  onSubmit,
}: {
  readonly dispatcher: Dispatcher;
  readonly onSubmit?: () => void;
}): ReactNode {
  const nav = useNav();
  return (
    <>
      <KumikoLink to={{ screenId: "list" }} data-testid="link-list">
        List
      </KumikoLink>
      <GoToListButton />
      <DispatcherProvider dispatcher={dispatcher}>
        <RenderEdit<TaskValues>
          screen={taskScreen}
          entity={taskEntity}
          featureName="tasks"
          initial={{ title: "" }}
          writeCommand="task:create"
          onSubmit={() => {
            onSubmit?.();
            nav.navigate({ screenId: "list" });
          }}
        />
      </DispatcherProvider>
      <LeaveGuardDialog />
    </>
  );
}

function renderHarness(dispatcher: Dispatcher, onSubmit?: () => void): void {
  render(
    <BrowserNav>
      <Harness dispatcher={dispatcher} {...(onSubmit && { onSubmit })} />
    </BrowserNav>,
  );
}

function typeTitle(value: string): void {
  const input = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
}

function dispatcherWriting(result: "success" | "invalid"): Dispatcher {
  return createMockDispatcher({
    write: (async () =>
      result === "success"
        ? { isSuccess: true, data: { id: "1" } }
        : {
            isSuccess: false,
            error: {
              code: "validation_failed",
              httpStatus: 422,
              i18nKey: "errors.validation.failed",
              message: "invalid",
              details: {
                fields: [{ path: "title", code: "custom", i18nKey: "errors.validation.custom" }],
              },
            },
          }) as unknown as Dispatcher["write"],
  });
}

function beforeUnloadEvent(): Event {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  window.history.replaceState(null, "", "/tasks");
});

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("leave guard", () => {
  test("a clean form navigates without asking", () => {
    renderHarness(dispatcherWriting("success"));
    fireEvent.click(screen.getByTestId("link-list"));
    expect(window.location.pathname).toBe("/list");
    expect(screen.queryByTestId("leave-guard-dialog")).toBeNull();
  });

  test("link click on a dirty form asks first; keeping the form stays on the page", async () => {
    renderHarness(dispatcherWriting("success"));
    typeTitle("draft");
    fireEvent.click(screen.getByTestId("link-list"));

    await waitFor(() => expect(screen.getByTestId("leave-guard-dialog")).toBeTruthy());
    expect(window.location.pathname).toBe("/tasks");

    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByTestId("leave-guard-dialog")).toBeNull());
    expect(window.location.pathname).toBe("/tasks");
  });

  test("confirming the dialog navigates", async () => {
    renderHarness(dispatcherWriting("success"));
    typeTitle("draft");
    fireEvent.click(screen.getByTestId("go-list"));

    await waitFor(() => expect(screen.getByTestId("leave-guard-dialog")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(window.location.pathname).toBe("/list"));
  });

  test("a successful submit clears the form before the follow-up navigation, so nothing asks", async () => {
    const onSubmit = mock(() => {});
    renderHarness(dispatcherWriting("success"), onSubmit);
    typeTitle("done");

    await act(async () => {
      fireEvent.submit(screen.getByTestId("render-edit-form"));
      await Promise.resolve();
    });

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(window.location.pathname).toBe("/list");
    expect(screen.queryByTestId("leave-guard-dialog")).toBeNull();
  });

  test("browser back on a dirty form restores the URL and asks; confirming then goes there", async () => {
    window.history.replaceState(null, "", "/previous");
    window.history.pushState(null, "", "/tasks");
    renderHarness(dispatcherWriting("success"));
    typeTitle("draft");

    act(() => {
      window.history.replaceState(null, "", "/previous");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    await waitFor(() => expect(screen.getByTestId("leave-guard-dialog")).toBeTruthy());
    expect(window.location.pathname).toBe("/tasks");

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(window.location.pathname).toBe("/previous"));
  });

  test("a second Back while the dialog is open neither stacks an entry nor drops the request; confirming steps back once", async () => {
    window.history.replaceState(null, "", "/previous");
    window.history.pushState(null, "", "/tasks");
    renderHarness(dispatcherWriting("success"));
    typeTitle("draft");

    act(() => {
      window.history.replaceState(null, "", "/previous");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await waitFor(() => expect(screen.getByTestId("leave-guard-dialog")).toBeTruthy());
    const lengthWithDialog = window.history.length;

    act(() => {
      window.history.replaceState(null, "", "/elsewhere");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(window.location.pathname).toBe("/tasks");
    expect(window.history.length).toBe(lengthWithDialog);
    expect(screen.getByTestId("leave-guard-dialog")).toBeTruthy();

    const back = mock(() => {
      window.history.replaceState(null, "", "/previous");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    const originalBack = window.history.back.bind(window.history);
    window.history.back = back;
    try {
      fireEvent.click(screen.getByRole("button", { name: "Discard" }));
      await waitFor(() => expect(window.location.pathname).toBe("/previous"));
      expect(back).toHaveBeenCalledTimes(1);
      expect(window.history.length).toBe(lengthWithDialog);
    } finally {
      window.history.back = originalBack;
    }
  });

  test("browser Back on a dirty form is undone by stepping forward again; Discard replays it without extra entries", async () => {
    renderHarness(dispatcherWriting("success"));
    typeTitle("draft");
    fireEvent.click(screen.getByTestId("go-list"));
    await waitFor(() => expect(screen.getByTestId("leave-guard-dialog")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(window.location.pathname).toBe("/list"));
    const lengthBefore = window.history.length;

    window.history.back();

    await waitFor(() => expect(screen.getByTestId("leave-guard-dialog")).toBeTruthy());
    await waitFor(() => expect(window.location.pathname).toBe("/list"));
    expect(window.history.length).toBe(lengthBefore);

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(window.location.pathname).toBe("/tasks"));
    expect(window.history.length).toBe(lengthBefore);
    expect(screen.queryByTestId("leave-guard-dialog")).toBeNull();
  });

  test("beforeunload is only prevented while the form holds unsaved input", () => {
    renderHarness(dispatcherWriting("success"));
    expect(beforeUnloadEvent().defaultPrevented).toBe(false);
    typeTitle("draft");
    expect(beforeUnloadEvent().defaultPrevented).toBe(true);
  });

  test("unmounting the form releases the guard", () => {
    const view = render(
      <BrowserNav>
        <Harness dispatcher={dispatcherWriting("success")} />
      </BrowserNav>,
    );
    typeTitle("draft");
    view.unmount();
    expect(beforeUnloadEvent().defaultPrevented).toBe(false);
  });
});

describe("leave guard with an extension section that saves host values itself", () => {
  const extensionScreen: EntityEditScreenDefinition = {
    id: "tasks:screen:task-edit-ext",
    type: "entityEdit",
    entity: "task",
    layout: {
      sections: [
        { title: "Basics", columns: 1, fields: ["title"] },
        { kind: "extension", title: "Publish", component: { react: { __component: "SelfSaver" } } },
      ],
    },
  };

  function SelfSaver({ patch, markSaved }: ExtensionSectionProps): ReactNode {
    const nav = useNav();
    return (
      <>
        <button
          type="button"
          data-testid="patch-host"
          onClick={() => patch?.({ title: "changed" })}
        >
          patch
        </button>
        <button
          type="button"
          data-testid="save-and-leave"
          onClick={() => {
            markSaved?.();
            nav.navigate({ screenId: "list" });
          }}
        >
          save
        </button>
        <button
          type="button"
          data-testid="save-title-and-leave"
          onClick={() => {
            markSaved?.(["title"]);
            nav.navigate({ screenId: "list" });
          }}
        >
          save title
        </button>
        <button
          type="button"
          data-testid="save-other-and-leave"
          onClick={() => {
            markSaved?.(["unrelated"]);
            nav.navigate({ screenId: "list" });
          }}
        >
          save other
        </button>
        <button
          type="button"
          data-testid="leave-without-mark"
          onClick={() => nav.navigate({ screenId: "list" })}
        >
          leave
        </button>
      </>
    );
  }

  const footerScreen: EntityEditScreenDefinition = {
    ...extensionScreen,
    id: "tasks:screen:task-edit-footer",
    layout: { sections: [{ title: "Basics", columns: 1, fields: ["title"] }] },
    slots: { footer: { react: { __component: "FooterSaver" } } },
  };

  function FooterSaver({ markSaved }: ExtensionSectionProps): ReactNode {
    const nav = useNav();
    return (
      <>
        <button
          type="button"
          data-testid="footer-save-and-leave"
          onClick={() => {
            markSaved?.();
            nav.navigate({ screenId: "list" });
          }}
        >
          save
        </button>
        <button
          type="button"
          data-testid="footer-leave-without-mark"
          onClick={() => nav.navigate({ screenId: "list" })}
        >
          leave
        </button>
      </>
    );
  }

  function renderFooterForm(): void {
    render(
      <BrowserNav>
        <DispatcherProvider dispatcher={dispatcherWriting("success")}>
          <ExtensionSectionsProvider value={{ FooterSaver }}>
            <RenderEdit<TaskValues>
              screen={footerScreen}
              entity={taskEntity}
              featureName="tasks"
              initial={{ title: "" }}
              writeCommand="task:update"
              entityId="t-1"
            />
          </ExtensionSectionsProvider>
        </DispatcherProvider>
        <LeaveGuardDialog />
      </BrowserNav>,
    );
  }

  function renderExtensionForm(): void {
    render(
      <BrowserNav>
        <DispatcherProvider dispatcher={dispatcherWriting("success")}>
          <ExtensionSectionsProvider value={{ SelfSaver }}>
            <RenderEdit<TaskValues>
              screen={extensionScreen}
              entity={taskEntity}
              featureName="tasks"
              initial={{ title: "" }}
              writeCommand="task:update"
              entityId="t-1"
            />
          </ExtensionSectionsProvider>
        </DispatcherProvider>
        <LeaveGuardDialog />
      </BrowserNav>,
    );
  }

  test("markSaved after patching host values lets the next navigation pass without asking", async () => {
    renderExtensionForm();
    fireEvent.click(screen.getByTestId("patch-host"));
    fireEvent.click(screen.getByTestId("save-and-leave"));

    await waitFor(() => expect(window.location.pathname).toBe("/list"));
    expect(screen.queryByTestId("leave-guard-dialog")).toBeNull();
  });

  test("markSaved with the written fields lets the navigation pass", async () => {
    renderExtensionForm();
    fireEvent.click(screen.getByTestId("patch-host"));
    fireEvent.click(screen.getByTestId("save-title-and-leave"));

    await waitFor(() => expect(window.location.pathname).toBe("/list"));
    expect(screen.queryByTestId("leave-guard-dialog")).toBeNull();
  });

  test("markSaved for other fields keeps the patched host field unsaved and asks before leaving", async () => {
    renderExtensionForm();
    fireEvent.click(screen.getByTestId("patch-host"));
    fireEvent.click(screen.getByTestId("save-other-and-leave"));

    await waitFor(() => expect(screen.getByTestId("leave-guard-dialog")).toBeTruthy());
    expect(window.location.pathname).toBe("/tasks");
  });

  test("markSaved from one section keeps another section's unsaved input guarded", async () => {
    function DirtySection(): ReactNode {
      useExtensionFormSubmit({ dirty: true, onSubmit: async () => ({ isSuccess: true }) });
      return null;
    }
    const twoSectionScreen: EntityEditScreenDefinition = {
      ...extensionScreen,
      layout: {
        sections: [
          ...extensionScreen.layout.sections,
          {
            kind: "extension",
            title: "Other",
            component: { react: { __component: "DirtySection" } },
          },
        ],
      },
    };
    render(
      <BrowserNav>
        <DispatcherProvider dispatcher={dispatcherWriting("success")}>
          <ExtensionSectionsProvider value={{ SelfSaver, DirtySection }}>
            <RenderEdit<TaskValues>
              screen={twoSectionScreen}
              entity={taskEntity}
              featureName="tasks"
              initial={{ title: "" }}
              writeCommand="task:update"
              entityId="t-1"
            />
          </ExtensionSectionsProvider>
        </DispatcherProvider>
        <LeaveGuardDialog />
      </BrowserNav>,
    );
    fireEvent.click(screen.getByTestId("patch-host"));
    fireEvent.click(screen.getByTestId("save-and-leave"));

    await waitFor(() => expect(screen.getByTestId("leave-guard-dialog")).toBeTruthy());
    expect(window.location.pathname).toBe("/tasks");
  });

  test("without markSaved the same patched form asks before leaving", async () => {
    renderExtensionForm();
    fireEvent.click(screen.getByTestId("patch-host"));
    fireEvent.click(screen.getByTestId("leave-without-mark"));

    await waitFor(() => expect(screen.getByTestId("leave-guard-dialog")).toBeTruthy());
    expect(window.location.pathname).toBe("/tasks");
  });

  test("footer slot: markSaved after the host values changed lets the navigation pass without asking", async () => {
    renderFooterForm();
    typeTitle("changed");
    fireEvent.click(screen.getByTestId("footer-save-and-leave"));

    await waitFor(() => expect(window.location.pathname).toBe("/list"));
    expect(screen.queryByTestId("leave-guard-dialog")).toBeNull();
  });

  test("footer slot: without markSaved the dirty form asks before leaving", async () => {
    renderFooterForm();
    typeTitle("changed");
    fireEvent.click(screen.getByTestId("footer-leave-without-mark"));

    await waitFor(() => expect(screen.getByTestId("leave-guard-dialog")).toBeTruthy());
    expect(window.location.pathname).toBe("/tasks");
  });
});

describe("leave guard on projectionDetail tabs", () => {
  test("switching away from a dirty writeForm tab asks before changing the tab", async () => {
    const detailScreen: ProjectionDetailScreenDefinition = {
      id: "session-detail",
      type: "projectionDetail",
      query: "sessions:query:user-session:detail",
      idParam: "id",
      layout: {
        mode: "tabs",
        sections: [
          { id: "overview", title: "Session", fields: ["userId"] },
          {
            id: "note",
            kind: "writeForm",
            title: "Add note",
            fieldDefs: { body: { type: "text" } },
            fields: ["body"],
            handler: "sessions:write:add-note",
          },
        ],
      },
    };
    const schema: FeatureSchema = {
      featureName: "sessions",
      entities: {},
      screens: [detailScreen],
    };
    const dispatcher = createMockDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { userId: "user-42" },
      })) as unknown as Dispatcher["query"],
    });
    const setSearchParams = mock(() => {});
    render(
      <NavProvider
        value={{
          route: undefined,
          navigate: () => {},
          replace: () => {},
          hrefFor: () => "",
          searchParams: { tab: "note" },
          setSearchParams,
        }}
      >
        <DispatcherProvider dispatcher={dispatcher}>
          <KumikoScreen schema={schema} qn="sessions:screen:session-detail" entityId="sess-1" />
          <LeaveGuardDialog />
        </DispatcherProvider>
      </NavProvider>,
    );

    await waitFor(() => screen.getByTestId("write-form-section-submit"));
    const input = screen.getByTestId("field-body").querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "unsent note" } });

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Session" }), { button: 0 });
    await waitFor(() => expect(screen.getByTestId("leave-guard-dialog")).toBeTruthy());
    expect(setSearchParams).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(setSearchParams).toHaveBeenCalledWith({ tab: "overview" }));
  });
});

describe("leave guard on setSearchParams-based navigation", () => {
  function ReturnToButton(): ReactNode {
    const nav = useNav();
    return (
      <button
        type="button"
        data-testid="go-with-return"
        onClick={() =>
          navigateWithReturnTo(
            nav,
            { screenId: "list" },
            { screenId: "tasks:screen:task-edit" },
            {
              flag: "1",
            },
          )
        }
      >
        go
      </button>
    );
  }

  function renderWithReturnButton(): void {
    render(
      <BrowserNav>
        <ReturnToButton />
        <DispatcherProvider dispatcher={dispatcherWriting("success")}>
          <RenderEdit<TaskValues>
            screen={taskScreen}
            entity={taskEntity}
            featureName="tasks"
            initial={{ title: "" }}
            writeCommand="task:create"
          />
        </DispatcherProvider>
        <LeaveGuardDialog />
      </BrowserNav>,
    );
  }

  test("a dirty form asks once; keeping the input leaves the URL and the field untouched", async () => {
    renderWithReturnButton();
    typeTitle("draft");
    fireEvent.click(screen.getByTestId("go-with-return"));

    await waitFor(() => expect(screen.getByTestId("leave-guard-dialog")).toBeTruthy());
    expect(window.location.pathname + window.location.search).toBe("/tasks");

    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByTestId("leave-guard-dialog")).toBeNull());
    expect(window.location.pathname + window.location.search).toBe("/tasks");
    const input = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("draft");
  });

  test("confirming navigates and applies the params without a second question", async () => {
    renderWithReturnButton();
    typeTitle("draft");
    fireEvent.click(screen.getByTestId("go-with-return"));
    await waitFor(() => expect(screen.getByTestId("leave-guard-dialog")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(window.location.pathname).toBe("/list"));
    expect(new URLSearchParams(window.location.search).get("flag")).toBe("1");
    expect(screen.queryByTestId("leave-guard-dialog")).toBeNull();
  });

  test("a clean form navigates with params right away", () => {
    renderWithReturnButton();
    fireEvent.click(screen.getByTestId("go-with-return"));
    expect(window.location.pathname).toBe("/list");
    expect(new URLSearchParams(window.location.search).get("flag")).toBe("1");
  });
});
