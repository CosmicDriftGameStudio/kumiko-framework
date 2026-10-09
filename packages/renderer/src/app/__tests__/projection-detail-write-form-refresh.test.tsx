// A writeForm submit on a projectionDetail refetches the record and the
// sibling relatedList instead of remounting RenderEdit, so unsaved input in
// the other writeForm section survives (rule: never lose input silently).

import { describe, expect, test } from "bun:test";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import { fireEvent, render, screen as rtlScreen, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context.js";
import { UserRolesProvider } from "../../context/user-roles-context.js";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.js";
import { kumikoDefaultTranslations } from "../../i18n-defaults.js";
import {
  type ButtonProps,
  type CorePrimitives,
  type FormProps,
  PrimitivesProvider,
  type SectionProps,
} from "../../primitives.js";
import { AppFeaturesProvider } from "../app-features-context.js";
import type { FeatureSchema } from "../feature-schema.js";
import { KumikoScreen } from "../kumiko-screen.js";
import type { NavApi } from "../nav.js";
import { NavProvider } from "../nav.js";

const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const TestForm: ComponentType<FormProps> = ({ children }) => (
  <div data-testid="form-body">{children}</div>
);

const TestButton: ComponentType<ButtonProps> = ({ children, onClick, testId, disabled }) => (
  <button type="button" data-testid={testId} onClick={onClick} disabled={disabled}>
    {children}
  </button>
);

const TestInput: ComponentType<{
  name?: string;
  value?: unknown;
  onChange?: (v: unknown) => void;
}> = ({ name = "field", value, onChange }) => (
  <input
    aria-label={name}
    value={typeof value === "string" ? value : ""}
    onChange={(e) => onChange?.(e.target.value)}
  />
);

// Section testId already carries the section title, so the two writeForm
// submit buttons are reachable through their own section.
const TestSection: ComponentType<SectionProps> = ({ testId, children, actions }) => (
  <div data-testid={testId}>
    {children}
    {actions}
  </div>
);

const testPrimitives = {
  Button: TestButton,
  Banner: noop,
  Field: passChildren,
  Input: TestInput,
  DataTable: noop,
  Form: TestForm,
  Section: TestSection,
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
} as unknown as CorePrimitives;

const DETAIL_QUERY = "app:query:order-detail";
const NOTES_QUERY = "app:query:order-notes";

function textFieldDef(): {
  readonly type: "text";
  readonly maxLength: number;
  readonly required: false;
  readonly searchable: false;
  readonly sortable: false;
} {
  return { type: "text", maxLength: 100, required: false, searchable: false, sortable: false };
}

const orderScreen = {
  id: "order-detail",
  type: "projectionDetail",
  query: DETAIL_QUERY,
  layout: {
    sections: [
      { title: "Info", fields: ["name"] },
      {
        kind: "writeForm",
        title: "Note A",
        columns: 1,
        handler: "app:write:note-a",
        fieldDefs: { noteA: textFieldDef() },
        fields: ["noteA"],
      },
      {
        kind: "writeForm",
        title: "Note B",
        columns: 1,
        handler: "app:write:note-b",
        fieldDefs: { noteB: textFieldDef() },
        fields: ["noteB"],
      },
      {
        kind: "relatedList",
        title: "Notes",
        query: NOTES_QUERY,
        parentParam: "orderId",
        columns: ["text"],
      },
    ],
  },
} as unknown as FeatureSchema["screens"][number];

type Calls = {
  readonly queries: Array<{ type: string; payload: unknown }>;
  readonly writes: Array<{ type: string; payload: unknown }>;
};

function stubDispatcher(calls: Calls, state: { name: string }): Dispatcher {
  return {
    write: (async (type: string, payload: unknown) => {
      calls.writes.push({ type, payload });
      state.name = "Renamed";
      return { isSuccess: true, data: {} };
    }) as unknown as Dispatcher["write"],
    query: (async (type: string, payload: unknown) => {
      calls.queries.push({ type, payload });
      if (type === NOTES_QUERY) {
        return { isSuccess: true, data: { rows: [], nextCursor: null } };
      }
      return { isSuccess: true, data: { id: "o1", name: state.name } };
    }) as unknown as Dispatcher["query"],
    batch: (async () => ({ isSuccess: true, results: [] })) as unknown as Dispatcher["batch"],
    statusStore: {
      getState: () => "online",
      subscribe: () => () => {},
    } as unknown as Dispatcher["statusStore"],
    async *stream() {},
    pendingWrites: () => [],
    pendingFiles: () => [],
  };
}

function renderOrderScreen(calls: Calls, state: { name: string }): void {
  const schema: FeatureSchema = { featureName: "app", entities: {}, screens: [orderScreen] };
  const navApi: NavApi = {
    route: { screenId: "app:screen:order-detail" },
    navigate: () => {},
    replace: () => {},
    hrefFor: () => "",
    searchParams: {},
    setSearchParams: () => {},
  };
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en-US" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <DispatcherProvider dispatcher={stubDispatcher(calls, state)}>
        <AppFeaturesProvider features={[schema]}>
          <UserRolesProvider roles={[]}>
            <NavProvider value={navApi}>
              <PrimitivesProvider value={testPrimitives}>
                <KumikoScreen schema={schema} qn="app:screen:order-detail" entityId="o1" />
              </PrimitivesProvider>
            </NavProvider>
          </UserRolesProvider>
        </AppFeaturesProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

function inputValue(label: string): string {
  return (rtlScreen.getByLabelText(label) as HTMLInputElement).value;
}

function infoText(): string {
  return rtlScreen.getByTestId("section-Info").textContent ?? "";
}

function submitIn(sectionTestId: string): void {
  const section = rtlScreen.getByTestId(sectionTestId);
  const button = section.querySelector<HTMLButtonElement>(
    '[data-testid="write-form-section-submit"]',
  );
  if (button === null) throw new Error(`no submit button in ${sectionTestId}`);
  fireEvent.click(button);
}

describe("projectionDetail writeForm submit refreshes instead of remounting", () => {
  test("submitted section is reset, the other keeps its input, the detail shows the new record", async () => {
    const calls: Calls = { queries: [], writes: [] };
    const state = { name: "Original" };
    renderOrderScreen(calls, state);

    await waitFor(() => expect(rtlScreen.getByLabelText("noteA")).toBeTruthy());
    expect(infoText()).toBe("Original");

    fireEvent.change(rtlScreen.getByLabelText("noteA"), { target: { value: "first" } });
    fireEvent.change(rtlScreen.getByLabelText("noteB"), { target: { value: "unsent" } });
    expect(inputValue("noteA")).toBe("first");
    submitIn("write-form-Note A");

    await waitFor(() => expect(calls.writes).toHaveLength(1));
    expect(calls.writes[0]).toEqual({ type: "app:write:note-a", payload: { noteA: "first" } });
    await waitFor(() => expect(infoText()).toBe("Renamed"));
    expect(inputValue("noteA")).toBe("");
    expect(inputValue("noteB")).toBe("unsent");
  });

  test("the relatedList section refetches after the submit", async () => {
    const calls: Calls = { queries: [], writes: [] };
    renderOrderScreen(calls, { name: "Original" });
    const notesCalls = (): number => calls.queries.filter((q) => q.type === NOTES_QUERY).length;

    await waitFor(() => expect(notesCalls()).toBe(1));
    fireEvent.change(rtlScreen.getByLabelText("noteA"), { target: { value: "first" } });
    submitIn("write-form-Note A");

    await waitFor(() => expect(notesCalls()).toBe(2));
    expect(calls.queries.find((q) => q.type === NOTES_QUERY)?.payload).toMatchObject({
      orderId: "o1",
    });
  });
});
