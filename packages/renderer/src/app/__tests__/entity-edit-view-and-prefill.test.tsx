// Real create/update paths (KumikoScreen -> EntityEdit*Body -> RenderEdit):
// screen.readOnly turns an existing record into a view, prefill seeds the
// create form only. Time is pinned with setSystemTime so "today" is exact.

import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context.tsx";
import { CurrentUserProvider } from "../../current-user.tsx";
import type { Dispatcher } from "../../headless/index.ts";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.tsx";
import { kumikoDefaultTranslations } from "../../i18n-defaults.ts";
import {
  type ButtonProps,
  type CorePrimitives,
  type EmbeddedListInputProps,
  type FormProps,
  type InputProps,
  PrimitivesProvider,
} from "../../primitives.tsx";
import type { FeatureSchema } from "../feature-schema.ts";
import { KumikoScreen } from "../kumiko-screen.tsx";
import { NavProvider } from "../nav.tsx";

const capturedInputs: Record<string, InputProps | undefined> = {};
let capturedTitle: ReactNode;
const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;
const domButton: ComponentType<ButtonProps> = (props) => (
  <button
    type={props.type ?? "button"}
    data-testid={props.testId}
    disabled={props.disabled}
    onClick={() => void props.onClick?.()}
  >
    {props.children}
  </button>
);
const domForm: ComponentType<FormProps> = (props) => {
  capturedTitle = props.title;
  return (
    <form>
      {props.children}
      {props.secondaryActions}
      {props.actions}
    </form>
  );
};
let capturedInputList: InputProps[] = [];
const captureInput: ComponentType<InputProps> = (props) => {
  capturedInputs[props.name] = props;
  capturedInputList.push(props);
  return null;
};
let capturedEmbeddedList: EmbeddedListInputProps | undefined;
const captureEmbeddedList: ComponentType<EmbeddedListInputProps> = (props) => {
  capturedEmbeddedList = props;
  return null;
};

const testPrimitives: CorePrimitives = {
  Button: domButton,
  Banner: passChildren,
  Field: passChildren,
  Input: captureInput,
  EmbeddedListInput: captureEmbeddedList,
  DataTable: noop,
  Form: domForm,
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

function stubDispatcher(record: Readonly<Record<string, unknown>>): Dispatcher {
  return {
    write: (async () => ({ isSuccess: true, data: {} })) as unknown as Dispatcher["write"],
    query: (async () => ({ isSuccess: true, data: record })) as unknown as Dispatcher["query"],
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

function buildSchema(
  readOnly: EntityEditScreenDefinition["readOnly"],
  lockedWhen: EntityDefinition["lockedWhen"],
): FeatureSchema {
  const entity: EntityDefinition = {
    ...(lockedWhen !== undefined && { lockedWhen }),
    fields: {
      acknowledged: { type: "boolean", required: false },
      inspector: {
        type: "text",
        maxLength: 200,
        required: false,
        searchable: false,
        sortable: false,
      },
      day: { type: "date", required: false },
      photo: { type: "file", required: false },
      photos: { type: "images" },
      checkpoints: {
        type: "embedded",
        multiple: true,
        schema: { text: { type: "text" } },
      },
    },
  };
  const screenDef: EntityEditScreenDefinition = {
    id: "protocol-edit",
    type: "entityEdit",
    entity: "protocol",
    layout: {
      sections: [
        {
          columns: 1,
          fields: [
            "acknowledged",
            { field: "inspector", prefill: { kind: "currentUser", property: "displayName" } },
            { field: "day", prefill: { kind: "today" } },
            "photo",
            "photos",
            "checkpoints",
          ],
        },
      ],
    },
    actions: [
      {
        kind: "writeHandler",
        id: "approve",
        label: "Approve",
        handler: "demo:write:protocol:approve",
      },
    ],
    ...(readOnly !== undefined && { readOnly }),
  };
  return {
    featureName: "demo",
    entities: { protocol: entity },
    screens: [screenDef],
  } as FeatureSchema;
}

function mount(opts: {
  readonly readOnly?: EntityEditScreenDefinition["readOnly"];
  readonly lockedWhen?: EntityDefinition["lockedWhen"];
  readonly record?: Readonly<Record<string, unknown>>;
  readonly entityId?: string;
  readonly userTimeZone?: string;
}): void {
  for (const key of Object.keys(capturedInputs)) delete capturedInputs[key];
  capturedTitle = undefined;
  capturedInputList = [];
  capturedEmbeddedList = undefined;
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en-US", timeZone: "UTC" })}
      fallbackBundles={[
        {
          "en-US": {
            "screen:protocol-edit.title": "Edit protocol",
            "screen:protocol-edit.view.title": "Protocol",
          },
        },
        kumikoDefaultTranslations,
      ]}
    >
      <CurrentUserProvider
        user={{
          id: "u1",
          email: "ines@example.com",
          displayName: "Ines Prüfer",
          ...(opts.userTimeZone !== undefined && { timeZone: opts.userTimeZone }),
        }}
      >
        <DispatcherProvider dispatcher={stubDispatcher(opts.record ?? {})}>
          <NavProvider
            value={{
              route: { screenId: "demo:protocol-edit" },
              navigate: () => {},
              replace: () => {},
              hrefFor: () => "",
              searchParams: {},
              setSearchParams: () => {},
            }}
          >
            <PrimitivesProvider value={testPrimitives}>
              <KumikoScreen
                schema={buildSchema(opts.readOnly, opts.lockedWhen)}
                qn="demo:screen:protocol-edit"
                {...(opts.entityId !== undefined && { entityId: opts.entityId })}
              />
            </PrimitivesProvider>
          </NavProvider>
        </DispatcherProvider>
      </CurrentUserProvider>
    </LocaleProvider>,
  );
}

beforeEach(() => setSystemTime(new Date("2026-03-10T23:30:00Z")));
afterEach(() => {
  cleanup();
  setSystemTime();
});

describe("entityEdit prefill", () => {
  test("create seeds today (in the user's zone) and the current user's display name", () => {
    mount({ userTimeZone: "Europe/Berlin" });
    expect(capturedInputs["day"]?.value).toBe("2026-03-11");
    expect(capturedInputs["inspector"]?.value).toBe("Ines Prüfer");
  });

  test("without a user zone the locale resolver's zone decides", () => {
    mount({});
    expect(capturedInputs["day"]?.value).toBe("2026-03-10");
  });

  test("the update form shows the stored values and never prefills", async () => {
    mount({
      entityId: "p1",
      userTimeZone: "Europe/Berlin",
      record: { id: "p1", version: 1, acknowledged: false, inspector: "", day: "" },
    });
    await waitFor(() => {
      expect(capturedInputs["inspector"]).toBeDefined();
    });
    expect(capturedInputs["inspector"]?.value).toBe("");
    expect(capturedInputs["day"]?.value).toBe("");
  });
});

describe("entityEdit readOnly view mode", () => {
  const record = {
    id: "p1",
    version: 1,
    acknowledged: true,
    inspector: "Ines",
    day: "2026-01-02",
    photo: "11111111-1111-4111-8111-111111111111",
    photos: ["22222222-2222-4222-8222-222222222222"],
    checkpoints: [{ text: "Brakes" }],
  };

  test("a matching condition disables every field and drops submit, discard and delete", async () => {
    mount({ entityId: "p1", record, readOnly: { field: "acknowledged", eq: true } });
    await waitFor(() => {
      expect(capturedInputs["inspector"]).toBeDefined();
    });
    expect(capturedInputs["inspector"]?.disabled).toBe(true);
    expect(capturedInputs["day"]?.disabled).toBe(true);
    expect(screen.queryByTestId("render-edit-submit")).toBeNull();
    expect(screen.queryByTestId("render-edit-discard")).toBeNull();
    expect(screen.queryByTestId("render-edit-delete")).toBeNull();
    expect(screen.getByTestId("render-edit-cancel")).toBeDefined();
    expect(capturedTitle).toBe("Protocol");
  });

  test("file inputs, the images list and the embedded list are locked; record actions stay", async () => {
    mount({ entityId: "p1", record, readOnly: { field: "acknowledged", eq: true } });
    await waitFor(() => {
      expect(capturedEmbeddedList).toBeDefined();
    });
    const fileInputs = capturedInputList.filter((i) => i.kind === "file" || i.kind === "image");
    // single file + one stored image; no empty "add" slot is offered in view mode
    expect(fileInputs.length).toBe(2);
    expect(fileInputs.every((i) => i.disabled === true)).toBe(true);
    expect(capturedEmbeddedList?.disabled).toBe(true);
    expect(screen.getByTestId("render-edit-action-approve")).toBeDefined();
  });

  test("the same fixture is editable when the condition does not hold", async () => {
    mount({
      entityId: "p1",
      record: { ...record, acknowledged: false },
      readOnly: { field: "acknowledged", eq: true },
    });
    await waitFor(() => {
      expect(capturedEmbeddedList).toBeDefined();
    });
    expect(capturedEmbeddedList?.disabled).toBeFalsy();
    const fileInputs = capturedInputList.filter((i) => i.kind === "file" || i.kind === "image");
    expect(fileInputs.length).toBeGreaterThan(2);
    expect(fileInputs.some((i) => i.disabled !== true)).toBe(true);
  });

  test("a non-matching condition keeps the normal edit form", async () => {
    mount({
      entityId: "p1",
      record: { ...record, acknowledged: false },
      readOnly: { field: "acknowledged", eq: true },
    });
    await waitFor(() => {
      expect(capturedInputs["inspector"]).toBeDefined();
    });
    expect(capturedInputs["inspector"]?.disabled).toBeFalsy();
    expect(screen.getByTestId("render-edit-submit")).toBeDefined();
    expect(screen.getByTestId("render-edit-delete")).toBeDefined();
    expect(capturedTitle).toBe("Edit protocol");
  });

  test("create ignores the condition", () => {
    mount({ readOnly: true });
    expect(capturedInputs["inspector"]?.disabled).toBeFalsy();
    expect(screen.getByTestId("render-edit-submit")).toBeDefined();
  });
});

describe("entityEdit view mode from entity.lockedWhen", () => {
  const record = { id: "p1", version: 1, acknowledged: true, inspector: "Ines", day: "" };
  const lockedWhen = { field: "acknowledged", eq: true } as const;

  test("a locked record opens as a view without its own screen.readOnly", async () => {
    mount({ entityId: "p1", record, lockedWhen });
    await waitFor(() => {
      expect(capturedInputs["inspector"]).toBeDefined();
    });
    expect(capturedInputs["inspector"]?.disabled).toBe(true);
    expect(screen.queryByTestId("render-edit-submit")).toBeNull();
    expect(screen.queryByTestId("render-edit-delete")).toBeNull();
  });

  test("an unlocked record stays editable", async () => {
    mount({ entityId: "p1", record: { ...record, acknowledged: false }, lockedWhen });
    await waitFor(() => {
      expect(capturedInputs["inspector"]).toBeDefined();
    });
    expect(capturedInputs["inspector"]?.disabled).toBeFalsy();
    expect(screen.getByTestId("render-edit-submit")).toBeDefined();
  });

  test("a record without the lock field opens as a view (fail-closed)", async () => {
    const { acknowledged: _omitted, ...recordWithoutLockField } = record;
    mount({ entityId: "p1", record: recordWithoutLockField, lockedWhen });
    await waitFor(() => {
      expect(capturedInputs["inspector"]).toBeDefined();
    });
    expect(capturedInputs["inspector"]?.disabled).toBe(true);
    expect(screen.queryByTestId("render-edit-submit")).toBeNull();
  });

  test("a screen.readOnly that does not match cannot unlock a locked record", async () => {
    mount({
      entityId: "p1",
      record,
      lockedWhen,
      readOnly: { field: "acknowledged", eq: false },
    });
    await waitFor(() => {
      expect(capturedInputs["inspector"]).toBeDefined();
    });
    expect(capturedInputs["inspector"]?.disabled).toBe(true);
  });
});
