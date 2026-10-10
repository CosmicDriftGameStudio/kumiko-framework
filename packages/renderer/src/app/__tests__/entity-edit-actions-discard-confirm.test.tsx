// entityEdit header actions reload or remount the update form, which would
// drop typed-but-unsaved input. While the form is dirty the action confirm
// must warn; a pristine form keeps the existing (confirm-free) behavior.

import { afterEach, describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context.js";
import { UserRolesProvider } from "../../context/user-roles-context.js";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.js";
import { kumikoDefaultTranslations } from "../../i18n-defaults.js";
import {
  type BannerProps,
  type ButtonProps,
  type CorePrimitives,
  type DialogProps,
  type FormProps,
  type InputProps,
  PrimitivesProvider,
} from "../../primitives.js";
import { AppFeaturesProvider } from "../app-features-context.js";
import type { FeatureSchema } from "../feature-schema.js";
import { KumikoScreen } from "../kumiko-screen.js";
import type { NavApi } from "../nav.js";
import { NavProvider } from "../nav.js";

afterEach(cleanup);

const DISCARD_LABEL = "Discard changes and continue";
const DISCARD_TEXT = "You have unsaved changes in this form. They will be lost if you continue.";

const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const TestButton: ComponentType<ButtonProps> = ({ children, onClick, testId }) => (
  <button type="button" data-testid={testId} onClick={() => void onClick?.()}>
    {children}
  </button>
);

const TestBanner: ComponentType<BannerProps> = ({ children, testId }) => (
  <div data-testid={testId}>{children}</div>
);

const TestInput: ComponentType<InputProps> = (props) =>
  props.kind === "text" ? (
    <input
      data-testid={`input-${props.name}`}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
    />
  ) : null;

const FormWithActions: ComponentType<FormProps> = ({
  children,
  actions,
  secondaryActions,
  headerRegion,
}) => (
  <>
    {headerRegion}
    {children}
    {secondaryActions}
    {actions}
  </>
);

const dialogSpy: { current: DialogProps | null } = { current: null };
const TestDialog = (props: DialogProps): ReactNode => {
  if (props.open) dialogSpy.current = props;
  return null;
};

const testPrimitives: CorePrimitives = {
  Button: TestButton,
  Banner: TestBanner,
  Field: passChildren,
  Input: TestInput,
  DataTable: noop,
  Form: FormWithActions,
  Section: passChildren,
  Card: ({ slots, children }) => (
    <>
      {slots?.headerActions}
      {children}
    </>
  ),
  Grid: passChildren,
  GridCell: passChildren,
  Text: passChildren,
  Heading: noop,
  Dialog: TestDialog,
  Modal: noop,
  Lightbox: noop,
  ConfigSourceBadge: noop,
  ConfigCascadeView: noop,
  Link: noop,
};

type Calls = { writes: number; detailQueries: number };

function stubDispatcher(calls: Calls): Dispatcher {
  return {
    write: (async () => {
      calls.writes += 1;
      return { isSuccess: true, data: {} };
    }) as unknown as Dispatcher["write"],
    query: (async () => {
      calls.detailQueries += 1;
      return { isSuccess: true, data: { id: "rent-1", version: 1, name: "April" } };
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

const archiveAction = {
  kind: "writeHandler",
  id: "archive",
  label: "actions.archive",
  handler: "app:write:rent:archive",
} as const;

const drawerAction = {
  kind: "drawer",
  id: "add-note",
  label: "actions.addNote",
  screen: "note-form",
} as const;

const entity: EntityDefinition = {
  fields: {
    name: { type: "text", maxLength: 200, required: false, searchable: false, sortable: false },
  },
};

function schemaWith(actions: EntityEditScreenDefinition["actions"]): FeatureSchema {
  const editScreen = {
    id: "rent-edit",
    type: "entityEdit",
    entity: "rent",
    layout: { sections: [{ columns: 1, fields: ["name"] }] },
    actions,
  } as EntityEditScreenDefinition;
  return { featureName: "app", entities: { rent: entity }, screens: [editScreen] } as FeatureSchema;
}

async function mountEdit(actions: EntityEditScreenDefinition["actions"]): Promise<{
  readonly calls: Calls;
  readonly getByTestId: (id: string) => HTMLElement;
}> {
  dialogSpy.current = null as DialogProps | null;
  const calls: Calls = { writes: 0, detailQueries: 0 };
  const schema = schemaWith(actions);
  const navApi: NavApi = {
    route: { screenId: "app:screen:rent-edit" },
    navigate: () => {},
    replace: () => {},
    hrefFor: () => "",
    searchParams: {},
    setSearchParams: () => {},
  };
  const { getByTestId } = render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en-US" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <DispatcherProvider dispatcher={stubDispatcher(calls)}>
        <AppFeaturesProvider features={[schema]}>
          <UserRolesProvider roles={[]}>
            <NavProvider value={navApi}>
              <PrimitivesProvider value={testPrimitives}>
                <KumikoScreen schema={schema} qn="app:screen:rent-edit" entityId="rent-1" />
              </PrimitivesProvider>
            </NavProvider>
          </UserRolesProvider>
        </AppFeaturesProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
  await waitFor(() => getByTestId("input-name"));
  return { calls, getByTestId };
}

describe("entityEdit header actions with unsaved input", () => {
  test("a writeHandler action asks before discarding; cancel keeps the input and writes nothing", async () => {
    const { calls, getByTestId } = await mountEdit([archiveAction]);
    fireEvent.change(getByTestId("input-name"), { target: { value: "May" } });
    await act(async () => {
      fireEvent.click(getByTestId("render-edit-action-archive"));
    });
    await waitFor(() => expect(dialogSpy.current?.open).toBe(true));
    expect(dialogSpy.current?.description).toBe(DISCARD_TEXT);
    expect(dialogSpy.current?.title).toBe("actions.archive");
    expect(dialogSpy.current?.confirmLabel).toBe(DISCARD_LABEL);
    await act(async () => {
      dialogSpy.current?.onOpenChange(false);
    });
    expect(calls.writes).toBe(0);
    expect((getByTestId("input-name") as HTMLInputElement).value).toBe("May");
  });

  test("confirming the discard dialog runs the action", async () => {
    const { calls, getByTestId } = await mountEdit([archiveAction]);
    fireEvent.change(getByTestId("input-name"), { target: { value: "May" } });
    await act(async () => {
      fireEvent.click(getByTestId("render-edit-action-archive"));
    });
    await waitFor(() => expect(dialogSpy.current?.open).toBe(true));
    await act(async () => {
      await dialogSpy.current?.onConfirm();
    });
    await waitFor(() => expect(calls.writes).toBe(1));
  });

  test("an untouched form runs the action without a discard confirm", async () => {
    const { calls, getByTestId } = await mountEdit([archiveAction]);
    await act(async () => {
      fireEvent.click(getByTestId("render-edit-action-archive"));
    });
    await waitFor(() => expect(calls.writes).toBe(1));
    expect(dialogSpy.current).toBeNull();
  });

  test("a drawer action asks before opening when the form is dirty", async () => {
    const { getByTestId } = await mountEdit([drawerAction]);
    fireEvent.change(getByTestId("input-name"), { target: { value: "May" } });
    await act(async () => {
      fireEvent.click(getByTestId("render-edit-action-add-note"));
    });
    await waitFor(() => expect(dialogSpy.current?.open).toBe(true));
    expect(dialogSpy.current?.description).toBe(DISCARD_TEXT);
    expect(dialogSpy.current?.confirmLabel).toBe(DISCARD_LABEL);
  });
});
