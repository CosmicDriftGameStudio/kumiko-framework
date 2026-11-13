// actionForm opened via useNavigateWithInitialValues(..., { submitThrough }):
// same screen, but the submit goes to the wrapper handler with the form values
// nested under valuesKey, and server issues under that key land on the field.

import { describe, expect, test } from "bun:test";
import type { ActionFormScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { type ComponentType, type ReactNode, useState } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context.tsx";
import type { Dispatcher } from "../../headless/index.ts";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.tsx";
import { kumikoDefaultTranslations } from "../../i18n-defaults.ts";
import {
  type ButtonProps,
  type CorePrimitives,
  type FieldProps,
  type FormProps,
  type InputProps,
  PrimitivesProvider,
} from "../../primitives.tsx";
import type { FeatureSchema } from "../feature-schema.ts";
import { KumikoScreen } from "../kumiko-screen.tsx";
import { type NavApi, NavProvider, type NavTarget, useNavigateWithInitialValues } from "../nav.tsx";

const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const TextInput: ComponentType<InputProps> = (props) =>
  props.kind === "text" ? (
    <input
      data-testid={`input-${props.name}`}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
  ) : null;

const FieldWithIssues: ComponentType<FieldProps> = ({ id, issues, children }) => (
  <div data-testid={`field-${id}`}>
    {children}
    {(issues ?? []).map((issue) => (
      <span key={issue.path} data-testid={`issue-${id}`}>
        {issue.path}
      </span>
    ))}
  </div>
);

const PlainForm: ComponentType<FormProps> = ({ onSubmit, children }) => (
  <form data-testid="form" onSubmit={onSubmit}>
    {children}
  </form>
);

const PlainButton: ComponentType<ButtonProps> = ({ children, type }) => (
  <button type={type ?? "button"}>{children}</button>
);

const testPrimitives: CorePrimitives = {
  Button: PlainButton,
  Banner: passChildren,
  Field: FieldWithIssues,
  Input: TextInput,
  EmbeddedListInput: noop,
  DataTable: noop,
  Form: PlainForm,
  Section: passChildren,
  Card: passChildren,
  Grid: passChildren,
  GridCell: passChildren,
  Text: passChildren,
  Heading: noop,
  Dialog: noop,
  Modal: noop,
  Lightbox: noop,
  ConfigSourceBadge: noop,
  ConfigCascadeView: noop,
  Link: noop,
};

const screen: ActionFormScreenDefinition = {
  id: "compose",
  type: "actionForm",
  handler: "shop:write:compose",
  fields: { subject: { type: "text" }, note: { type: "text" } },
  layout: { sections: [{ columns: 1, fields: ["subject", "note"] }] },
};

type Write = { readonly type: string; readonly payload: unknown };

function makeDispatcher(writes: Write[], respond: () => unknown): Dispatcher {
  return {
    write: (async (type: string, payload: unknown) => {
      writes.push({ type, payload });
      return respond();
    }) as unknown as Dispatcher["write"],
    query: (async () => ({ isSuccess: true, data: {} })) as unknown as Dispatcher["query"],
    batch: (async () => ({ isSuccess: true, results: [] })) as unknown as Dispatcher["batch"],
    statusStore: {
      getState: () => "online",
      subscribe: () => () => {},
    } as unknown as Dispatcher["statusStore"],
    async *stream() {},
    pendingWrites: () => [],
    pendingFiles: () => [],
  } satisfies Dispatcher;
}

type Opener = {
  offer: (
    target: string,
    options?: Parameters<ReturnType<typeof useNavigateWithInitialValues>>[2],
  ) => void;
  go: (screenId: string) => void;
  initialValues: Record<string, string>;
  navigations: NavTarget[];
};

function OpenerHook({ opener }: { readonly opener: Opener }): ReactNode {
  const navigateWithInitialValues = useNavigateWithInitialValues();
  opener.offer = (target, options) =>
    navigateWithInitialValues({ screenId: target }, opener.initialValues, options);
  return null;
}

function App({
  opener,
  dispatcher,
  screenDef,
}: {
  readonly opener: Opener;
  readonly dispatcher: Dispatcher;
  readonly screenDef: ActionFormScreenDefinition;
}): ReactNode {
  const [screenId, setScreenId] = useState("home");
  opener.go = setScreenId;
  const nav: NavApi = {
    route: { screenId },
    navigate: (target: NavTarget) => {
      opener.navigations.push(target);
      if ("screenId" in target) setScreenId(target.screenId);
    },
    replace: () => {},
    hrefFor: () => "",
    searchParams: {},
    setSearchParams: () => {},
  };
  return (
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "de-DE" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <DispatcherProvider dispatcher={dispatcher}>
        <NavProvider value={nav}>
          <PrimitivesProvider value={testPrimitives}>
            <OpenerHook opener={opener} />
            {screenId === "compose" && (
              <KumikoScreen
                schema={
                  {
                    featureName: "shop",
                    entities: {},
                    screens: [screenDef, { id: "detail", type: "entityEdit", entity: "item" }],
                  } as FeatureSchema
                }
                qn="shop:screen:compose"
              />
            )}
          </PrimitivesProvider>
        </NavProvider>
      </DispatcherProvider>
    </LocaleProvider>
  );
}

function mount(
  respond: () => unknown = () => ({ isSuccess: true, data: {} }),
  screenDef: ActionFormScreenDefinition = screen,
  initialValues: Record<string, string> = { subject: "Hello" },
): {
  readonly opener: Opener;
  readonly writes: Write[];
  readonly view: ReturnType<typeof render>;
} {
  const writes: Write[] = [];
  const opener: Opener = { offer: () => {}, go: () => {}, initialValues, navigations: [] };
  const view = render(
    <App opener={opener} dispatcher={makeDispatcher(writes, respond)} screenDef={screenDef} />,
  );
  return { opener, writes, view };
}

const submitThrough = {
  handler: "ai:write:execute-dialog-step",
  wrap: { planId: "p1", actionId: "a1" },
  valuesKey: "values",
} as const;

describe("actionForm submitThrough", () => {
  test("sends exactly one write to the wrapper handler with the values nested", async () => {
    const { opener, writes, view } = mount();
    act(() => opener.offer("compose", { submitThrough }));
    await waitFor(() => view.getByTestId("input-subject"));

    fireEvent.submit(view.getByTestId("form"));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({
      type: "ai:write:execute-dialog-step",
      payload: { planId: "p1", actionId: "a1", values: { subject: "Hello" } },
    });
  });

  test("a server issue under values.subject shows at the field subject", async () => {
    const { opener, view } = mount(() => ({
      isSuccess: false,
      error: {
        code: "validation_error",
        httpStatus: 400,
        i18nKey: "errors.validation",
        message: "Validation failed",
        details: {
          fields: [{ path: "values.subject", code: "too_small", i18nKey: "errors.validation" }],
        },
      },
    }));
    act(() => opener.offer("compose", { submitThrough }));
    await waitFor(() => view.getByTestId("input-subject"));

    fireEvent.submit(view.getByTestId("form"));

    const issue = await waitFor(() => view.getByTestId("issue-kumiko-edit-subject"));
    expect(issue.textContent).toBe("subject");
    expect(view.queryByTestId("issue-kumiko-edit-note")).toBeNull();
  });

  test("without submitThrough the write goes to the screen handler with the plain values", async () => {
    const { opener, writes, view } = mount();
    act(() => opener.offer("compose"));
    await waitFor(() => view.getByTestId("input-subject"));

    fireEvent.submit(view.getByTestId("form"));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({ type: "shop:write:compose", payload: { subject: "Hello" } });
  });

  test("a handoff for another screen does not apply to this form", async () => {
    const { opener, writes, view } = mount();
    act(() => opener.offer("other", { submitThrough }));
    act(() => opener.go("compose"));
    await waitFor(() => view.getByTestId("input-subject"));

    fireEvent.submit(view.getByTestId("form"));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]?.type).toBe("shop:write:compose");
  });
});

describe("actionForm submitThrough response data", () => {
  const wrapperResponse = { isSuccess: true, data: { id: "rec-7", count: 917, actionId: "a1" } };

  test("the redirect reads its id from the wrapper handler's data", async () => {
    const { opener, view } = mount(() => wrapperResponse, {
      ...screen,
      redirect: { screen: "detail", idFrom: "id" },
    });
    act(() => opener.offer("compose", { submitThrough }));
    await waitFor(() => view.getByTestId("input-subject"));
    opener.navigations.length = 0;

    fireEvent.submit(view.getByTestId("form"));

    await waitFor(() =>
      expect(opener.navigations).toContainEqual(
        expect.objectContaining({ screenId: "detail", entityId: "rec-7" }),
      ),
    );
  });

  test("successFacts read their value from the wrapper handler's data", async () => {
    const { opener, view } = mount(() => wrapperResponse, {
      ...screen,
      successFacts: [{ field: "count", label: "shop.fact.count" }],
    });
    act(() => opener.offer("compose", { submitThrough }));
    await waitFor(() => view.getByTestId("input-subject"));

    fireEvent.submit(view.getByTestId("form"));

    await waitFor(() => expect(view.container.textContent).toContain("shop.fact.count: 917"));
  });
});

describe("actionForm submitThrough payload shaping", () => {
  const excludingScreen: ActionFormScreenDefinition = {
    ...screen,
    writeExcludedFields: ["note"],
  };

  test("write-excluded fields stay out of values and a same-named wrap key survives", async () => {
    const { opener, writes, view } = mount(undefined, excludingScreen, {
      subject: "Hello",
      note: "display only",
    });
    act(() =>
      opener.offer("compose", { submitThrough: { ...submitThrough, wrap: { note: "keep" } } }),
    );
    await waitFor(() => view.getByTestId("input-subject"));

    fireEvent.submit(view.getByTestId("form"));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]?.payload).toEqual({ note: "keep", values: { subject: "Hello" } });
  });
});
