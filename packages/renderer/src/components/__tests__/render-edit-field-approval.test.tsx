import { beforeEach, describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
  FeatureSchema,
} from "@cosmicdrift/kumiko-framework/ui-types";
import {
  act,
  fireEvent,
  render,
  screen as rtlScreen,
  waitFor,
  within,
} from "@testing-library/react";
import { type ComponentType, type ReactNode, useState } from "react";
import { type RecordedWrite, stubDispatcher } from "../../__tests__/stub-dispatcher.ts";
import { AppFeaturesProvider } from "../../app/app-features-context.tsx";
import { type ActionNotice, ActionNoticeProvider } from "../../app/client-actions.tsx";
import {
  type ExtensionSubmitContext,
  useExtensionFormSubmit,
} from "../../app/extension-form-submit.tsx";
import { ExtensionSectionsProvider } from "../../app/extension-sections.tsx";
import { DispatcherProvider } from "../../context/dispatcher-context.tsx";
import type { BatchResult, Command, WriteResult } from "../../headless/index.ts";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.tsx";
import { kumikoDefaultTranslations } from "../../i18n-defaults.ts";
import { mapServerError } from "../../live/error-mapping.ts";
import {
  type BannerProps,
  type ButtonProps,
  type DialogProps,
  type DrawerProps,
  type FieldProps,
  type FormProps,
  type InputProps,
  PrimitivesProvider,
  type TextProps,
} from "../../primitives.tsx";
import { createStubPrimitives } from "../../testing.ts";
import { RenderEdit } from "../render-edit.tsx";

type Values = { name: string; iban: string; bic: string };

const OLD_IBAN = "DE02120300000000202051";
const NEW_IBAN = "DE89370400440532013000";
const OLD_BIC = "BYLADEM1001";
const UPDATE = "contacts:write:contact:update";
const CREATE = "contacts:write:contact:create";
const REQUEST_CHANGE = "field-approval:write:request-change";
const REJECT_CHANGE = "field-approval:write:reject-change";
const PENDING_CHANGES = "field-approval:query:pending-changes";
const DRAWER = "render-edit-field-approval-drawer";
// The drawer form nests in the record form, so its field ids carry a scope of their own.
const DRAWER_IBAN_ISSUE = /^field-kumiko-edit-.+-iban-issue$/;

const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const testButton: ComponentType<ButtonProps> = ({ children, onClick, testId, type, disabled }) => (
  <button type={type ?? "button"} data-testid={testId} onClick={onClick} disabled={disabled}>
    {children}
  </button>
);

const testForm: ComponentType<FormProps> = ({ children, actions, onSubmit }) => (
  <form
    onSubmit={(e) => {
      e.preventDefault();
      onSubmit();
    }}
  >
    {children}
    {actions}
  </form>
);

const testInput: ComponentType<InputProps> = (props) =>
  props.kind === "text" ? (
    <input
      aria-label={props.name}
      value={props.value}
      disabled={props.disabled}
      onChange={(e) => props.onChange(e.target.value)}
    />
  ) : null;

const testField: ComponentType<FieldProps> = ({
  id,
  description,
  status,
  issues,
  children,
  fieldAppendix,
}) => (
  <div data-testid={`field-${id}`}>
    {status !== undefined ? <span data-tone={status.tone}>{status.label}</span> : null}
    {children}
    {fieldAppendix}
    {description !== undefined ? <span>{description}</span> : null}
    {issues?.map((issue) => (
      <span key={issue.code} data-testid={`field-${id}-issue`}>
        {issue.i18nKey}
      </span>
    ))}
  </div>
);

const testBanner: ComponentType<BannerProps> = ({ children, actions, testId, variant }) => (
  <div data-testid={testId} data-variant={variant}>
    {children}
    {actions}
  </div>
);

const testText: ComponentType<TextProps> = ({ children, testId }) => (
  <span data-testid={testId}>{children}</span>
);

const testDrawer: ComponentType<DrawerProps> = ({ open, title, children, testId }) =>
  open ? (
    <section data-testid={testId} aria-label={title}>
      {children}
    </section>
  ) : null;

const testDialog: ComponentType<DialogProps> = ({ open, testId, onConfirm }) =>
  open ? (
    <button type="button" data-testid={testId} onClick={onConfirm}>
      confirm
    </button>
  ) : null;

const entity: EntityDefinition = {
  name: "contact",
  fields: {
    name: { type: "text", allowPlaintext: "test fixture", maxLength: 64 },
    iban: { type: "text", allowPlaintext: "test fixture", maxLength: 34, required: true },
    bic: { type: "text", allowPlaintext: "test fixture", maxLength: 11 },
    accessPin: { type: "text", allowPlaintext: "test fixture", writeOnly: true },
    manager: { type: "reference", entity: "user", labelField: "name" },
    notes: { type: "longText", allowPlaintext: "test fixture" },
  },
};

const MANAGER_ID = "7f3c2a10-0000-4000-8000-000000000001";

const editScreen: EntityEditScreenDefinition = {
  id: "contact-edit",
  type: "entityEdit",
  entity: "contact",
  layout: { sections: [{ title: "Main", fields: ["name", "iban", "bic"] }] },
};

const editScreenWithCustomFields: EntityEditScreenDefinition = {
  ...editScreen,
  layout: {
    sections: [
      { title: "Main", fields: ["name", "iban", "bic"] },
      {
        kind: "extension",
        title: "Custom Fields",
        component: { react: { __component: "ContactCustomFields" } },
        contributesToFormSubmit: true,
      },
    ],
  },
};

const editScreenWithAccessPin: EntityEditScreenDefinition = {
  ...editScreen,
  layout: { sections: [{ title: "Main", fields: ["name", "iban", "accessPin"] }] },
};

const editScreenWithManagerAndNotes: EntityEditScreenDefinition = {
  ...editScreen,
  layout: {
    sections: [
      {
        title: "Main",
        fields: ["name", "iban", "manager", { field: "notes", editor: "document" }],
      },
    ],
  },
};

let customFieldSubmits: ExtensionSubmitContext[] = [];

beforeEach(() => {
  customFieldSubmits = [];
});

function ContactCustomFields(): ReactNode {
  const [touched, setTouched] = useState(false);
  useExtensionFormSubmit({
    dirty: touched,
    onSubmit: async (ctx) => {
      customFieldSubmits.push(ctx);
      return { isSuccess: true as const };
    },
  });
  return (
    <button type="button" data-testid="custom-fields-touch" onClick={() => setTouched(true)}>
      touch
    </button>
  );
}

const fieldApprovalSchema: FeatureSchema = {
  featureName: "field-approval",
  entities: {},
  screens: [],
};

// The server's 403 envelope for a gated field, mapped like the live dispatcher maps it.
const approvalDenied = mapServerError({
  code: "access_denied",
  httpStatus: 403,
  i18nKey: "errors.access.fieldApprovalRequired",
  message: "field approval required",
  details: { reason: "field_approval_required", entity: "contact", fields: ["iban"] },
});

type OpenRequest = {
  readonly id: string;
  readonly version: number;
  readonly fieldName: string;
  readonly value?: unknown;
  readonly filedByCaller?: boolean;
};

type RecordedQuery = { readonly type: string; readonly payload: unknown };

type ContactEditSetup = {
  readonly features?: readonly FeatureSchema[];
  readonly gatedFields?: readonly string[];
  readonly openRequests?: readonly OpenRequest[];
  readonly screen?: EntityEditScreenDefinition;
  readonly entityId?: string;
  readonly rejectUpdate?: boolean;
  readonly payloadMode?: "values" | "changes";
  readonly initial?: Values;
  // Holds the pending-changes answer back until the test resolves it.
  readonly pendingChangesAnswered?: Promise<void>;
  readonly batch?: (commands: readonly Command[]) => BatchResult;
  readonly buildPayload?: (snapshot: {
    readonly changes: Readonly<Record<string, unknown>>;
  }) => unknown;
};

type ContactEditRun = {
  readonly writes: RecordedWrite[];
  readonly batches: (readonly Command[])[];
  readonly queries: RecordedQuery[];
  readonly notices: ActionNotice[];
};

function renderContactEdit(setup: ContactEditSetup = {}): ContactEditRun {
  const batches: (readonly Command[])[] = [];
  const queries: RecordedQuery[] = [];
  const notices: ActionNotice[] = [];
  const features = setup.features ?? [fieldApprovalSchema];
  const entityId = setup.entityId ?? "c1";
  const { dispatcher, writes } = stubDispatcher({
    query: async (type, payload) => {
      queries.push({ type, payload });
      if (type === PENDING_CHANGES) await setup.pendingChangesAnswered;
      return {
        isSuccess: true,
        data:
          type === PENDING_CHANGES
            ? { rows: setup.openRequests ?? [], gatedFields: setup.gatedFields ?? [] }
            : {},
      };
    },
    write: (type): WriteResult<unknown> =>
      type === UPDATE && setup.rejectUpdate === true
        ? { isSuccess: false, error: approvalDenied }
        : { isSuccess: true, data: { id: "c1" } },
    batch: (commands) => {
      batches.push(commands);
      return setup.batch?.(commands) ?? { isSuccess: true, results: [] };
    },
  });
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en-US" })}
      fallbackBundles={[
        { en: { "contacts:entity:contact:field:iban": "IBAN" } },
        kumikoDefaultTranslations,
      ]}
    >
      <AppFeaturesProvider features={features}>
        <DispatcherProvider dispatcher={dispatcher}>
          <ActionNoticeProvider notify={(notice) => notices.push(notice)}>
            <PrimitivesProvider
              value={createStubPrimitives({
                Button: testButton,
                Banner: testBanner,
                Field: testField,
                Input: testInput,
                Form: testForm,
                Section: passChildren,
                Card: passChildren,
                Grid: passChildren,
                GridCell: passChildren,
                Text: testText,
                Drawer: testDrawer,
                Dialog: testDialog,
              })}
            >
              <ExtensionSectionsProvider value={{ ContactCustomFields }}>
                <RenderEdit<Values>
                  screen={setup.screen ?? editScreen}
                  entity={entity}
                  featureName="contacts"
                  entityId={entityId}
                  writeCommand={entityId === "" ? CREATE : UPDATE}
                  payloadMode={setup.payloadMode ?? "changes"}
                  {...(setup.buildPayload !== undefined && { buildPayload: setup.buildPayload })}
                  initial={
                    setup.initial ??
                    (entityId === ""
                      ? { name: "", iban: "", bic: "" }
                      : { name: "Owner", iban: OLD_IBAN, bic: OLD_BIC })
                  }
                />
              </ExtensionSectionsProvider>
            </PrimitivesProvider>
          </ActionNoticeProvider>
        </DispatcherProvider>
      </AppFeaturesProvider>
    </LocaleProvider>,
  );
  return { writes, batches, queries, notices };
}

function input(name: string): HTMLInputElement {
  return rtlScreen.getByLabelText(name) as HTMLInputElement;
}

async function openDrawer(fieldName = "iban"): Promise<HTMLElement> {
  fireEvent.click(await rtlScreen.findByTestId(`field-approval-request-${fieldName}`));
  return rtlScreen.getByTestId(DRAWER);
}

function drawerInput(drawer: HTMLElement, name: string): HTMLInputElement {
  return within(drawer).getByLabelText(name) as HTMLInputElement;
}

describe("RenderEdit — the server lock stays as a safety net", () => {
  test("a refused save shows the approval error once at the field and keeps every input", async () => {
    renderContactEdit({ rejectUpdate: true });
    fireEvent.change(input("name"), { target: { value: "Owner GmbH" } });
    fireEvent.change(input("iban"), { target: { value: NEW_IBAN } });
    fireEvent.click(rtlScreen.getByTestId("render-edit-submit"));

    const issue = await rtlScreen.findByTestId("field-kumiko-edit-iban-issue");
    expect(issue.textContent).toBe("errors.access.fieldApprovalRequired");
    expect(rtlScreen.getAllByTestId("field-kumiko-edit-iban-issue")).toHaveLength(1);
    expect(rtlScreen.queryByTestId("render-edit-form-error")).toBeNull();
    expect(input("name").value).toBe("Owner GmbH");
    expect(input("iban").value).toBe(NEW_IBAN);
  });

  test("the refused save offers no pill and no submit-for-approval button in the form", async () => {
    renderContactEdit({ rejectUpdate: true });
    fireEvent.change(input("iban"), { target: { value: NEW_IBAN } });
    fireEvent.click(rtlScreen.getByTestId("render-edit-submit"));
    await rtlScreen.findByTestId("field-kumiko-edit-iban-issue");

    expect(rtlScreen.queryByText("Needs approval")).toBeNull();
    expect(rtlScreen.queryByTestId("render-edit-field-approval-submit")).toBeNull();
  });
});

describe("RenderEdit — gated fields", () => {
  test("a gated field is read-only and Save sends only the other fields", async () => {
    const { writes } = renderContactEdit({ gatedFields: ["iban", "bic"] });
    await rtlScreen.findByTestId("field-approval-request-iban");

    expect(input("iban").disabled).toBe(true);
    expect(input("name").disabled).toBe(false);
    fireEvent.change(input("name"), { target: { value: "Owner GmbH" } });
    fireEvent.click(rtlScreen.getByTestId("render-edit-submit"));

    await waitFor(() => expect(writes.filter((w) => w.type === UPDATE)).toHaveLength(1));
    const saved = JSON.stringify(writes.find((w) => w.type === UPDATE)?.payload);
    expect(saved).toContain("Owner GmbH");
    expect(saved).not.toContain("iban");
  });

  test("the drawer files only the changed field in one batch and writes no update", async () => {
    const { writes, batches } = renderContactEdit({ gatedFields: ["iban", "bic"] });
    const drawer = await openDrawer();

    expect(drawerInput(drawer, "bic").value).toBe(OLD_BIC);
    fireEvent.change(drawerInput(drawer, "iban"), { target: { value: NEW_IBAN } });
    fireEvent.click(within(drawer).getByTestId("render-edit-submit"));

    await waitFor(() => expect(batches).toHaveLength(1));
    expect(batches[0]).toEqual([
      {
        type: REQUEST_CHANGE,
        payload: { entityType: "contact", entityId: "c1", fieldName: "iban", value: NEW_IBAN },
      },
    ]);
    expect(writes.filter((w) => w.type === UPDATE)).toEqual([]);
  });

  test("a filed request closes the drawer and answers at the field, without a notice", async () => {
    const openRequests: OpenRequest[] = [];
    const run = renderContactEdit({
      gatedFields: ["iban"],
      openRequests,
      batch: () => {
        openRequests.push({
          id: "fcr-1",
          version: 1,
          fieldName: "iban",
          value: NEW_IBAN,
          filedByCaller: true,
        });
        return { isSuccess: true, results: [] };
      },
    });
    const drawer = await openDrawer();
    fireEvent.change(drawerInput(drawer, "iban"), { target: { value: NEW_IBAN } });
    fireEvent.click(within(drawer).getByTestId("render-edit-submit"));

    await waitFor(() => expect(rtlScreen.queryByTestId(DRAWER)).toBeNull());
    const hint = await rtlScreen.findByText(`Requested: ${NEW_IBAN} · awaiting approval`);
    expect(run.notices).toEqual([]);
    expect(rtlScreen.getByTestId("field-kumiko-edit-iban").contains(hint)).toBe(true);
    expect(run.queries.filter((q) => q.type === PENDING_CHANGES)).toHaveLength(2);
    expect(input("iban").value).toBe(OLD_IBAN);
  });

  test("a failed batch puts the error at the field inside the drawer and keeps it open", async () => {
    const { batches } = renderContactEdit({
      gatedFields: ["iban", "bic"],
      batch: () => ({
        isSuccess: false,
        failedIndex: 0,
        results: [],
        error: {
          code: "validation_failed",
          httpStatus: 400,
          i18nKey: "errors.validation.invalidIban",
          message: "invalid iban",
        },
      }),
    });
    const drawer = await openDrawer();
    fireEvent.change(drawerInput(drawer, "iban"), { target: { value: "DE00" } });
    fireEvent.click(within(drawer).getByTestId("render-edit-submit"));

    await waitFor(() => expect(batches).toHaveLength(1));
    const issue = await within(drawer).findByTestId(DRAWER_IBAN_ISSUE);
    expect(issue.textContent).toBe("errors.validation.invalidIban");
    expect(drawer.isConnected).toBe(true);
  });

  test("the drawer's client validation blocks the batch", async () => {
    const { batches } = renderContactEdit({ gatedFields: ["iban"] });
    const drawer = await openDrawer();
    fireEvent.change(drawerInput(drawer, "iban"), { target: { value: "" } });
    fireEvent.click(within(drawer).getByTestId("render-edit-submit"));

    await within(drawer).findByTestId(DRAWER_IBAN_ISSUE);
    expect(batches).toEqual([]);
  });

  test("an approver edits the gated field directly", async () => {
    const { writes } = renderContactEdit({ gatedFields: [] });
    await waitFor(() => expect(input("iban").disabled).toBe(false));
    expect(rtlScreen.queryByTestId("field-approval-request-iban")).toBeNull();
    fireEvent.change(input("iban"), { target: { value: NEW_IBAN } });
    fireEvent.click(rtlScreen.getByTestId("render-edit-submit"));

    await waitFor(() => expect(writes.filter((w) => w.type === UPDATE)).toHaveLength(1));
    expect(JSON.stringify(writes.find((w) => w.type === UPDATE)?.payload)).toContain(NEW_IBAN);
  });

  test("in create mode a gated field is read-only with the after-create hint and no action", async () => {
    const { queries } = renderContactEdit({ gatedFields: ["iban"], entityId: "" });

    const hint = await rtlScreen.findByText("Request a value once the record is saved");
    expect(rtlScreen.getByTestId("field-kumiko-edit-iban").contains(hint)).toBe(true);
    expect(input("iban").disabled).toBe(true);
    expect(rtlScreen.queryByTestId("field-approval-request-iban")).toBeNull();
    expect(queries).toContainEqual({
      type: PENDING_CHANGES,
      payload: { entityType: "contact", entityId: null },
    });
  });

  test("a form with a gated field saves a changed extension section through the one Save", async () => {
    const { writes } = renderContactEdit({
      gatedFields: ["iban"],
      screen: editScreenWithCustomFields,
    });
    await rtlScreen.findByTestId("field-approval-request-iban");
    fireEvent.click(rtlScreen.getByTestId("custom-fields-touch"));
    fireEvent.change(input("name"), { target: { value: "Owner GmbH" } });
    fireEvent.click(rtlScreen.getByTestId("render-edit-submit"));

    await waitFor(() => expect(customFieldSubmits).toEqual([{ entityId: "c1" }]));
    expect(writes.filter((w) => w.type === UPDATE)).toHaveLength(1);
    expect(writes.filter((w) => w.type === REQUEST_CHANGE)).toEqual([]);
  });

  test("with the entity-edit payload builder, an extension-only change sends no empty update", async () => {
    const { writes } = renderContactEdit({
      gatedFields: ["iban"],
      screen: editScreenWithCustomFields,
      buildPayload: (snapshot) => ({ id: "c1", version: 1, changes: snapshot.changes }),
    });
    await rtlScreen.findByTestId("field-approval-request-iban");
    fireEvent.click(rtlScreen.getByTestId("custom-fields-touch"));
    fireEvent.click(rtlScreen.getByTestId("render-edit-submit"));

    await waitFor(() => expect(customFieldSubmits).toEqual([{ entityId: "c1" }]));
    expect(writes.filter((w) => w.type === UPDATE)).toEqual([]);
  });

  test("without the field-approval feature the form asks nothing and the field stays editable", async () => {
    const { queries } = renderContactEdit({ features: [], gatedFields: ["iban"] });
    await rtlScreen.findByLabelText("iban");

    expect(queries.filter((q) => q.type === PENDING_CHANGES)).toEqual([]);
    expect(input("iban").disabled).toBe(false);
    expect(rtlScreen.queryByTestId("field-approval-request-iban")).toBeNull();
  });
});

describe("RenderEdit — gated fields at the edges", () => {
  test("in create mode an untouched gated field stays out of the payload, even with a start value", async () => {
    const { writes } = renderContactEdit({
      gatedFields: ["iban"],
      entityId: "",
      payloadMode: "values",
      initial: { name: "", iban: OLD_IBAN, bic: "" },
    });
    await rtlScreen.findByText("Request a value once the record is saved");
    fireEvent.change(input("name"), { target: { value: "Owner GmbH" } });
    fireEvent.click(rtlScreen.getByTestId("render-edit-submit"));

    await waitFor(() => expect(writes.filter((w) => w.type === CREATE)).toHaveLength(1));
    const created = writes.find((w) => w.type === CREATE)?.payload;
    expect(created).toMatchObject({ name: "Owner GmbH" });
    expect(created).not.toHaveProperty("iban");
  });

  test("a gated field typed into before the answer arrives stays editable until it is reverted", async () => {
    let answerPendingChanges = (): void => {};
    const pendingChangesAnswered = new Promise<void>((resolve) => {
      answerPendingChanges = resolve;
    });
    renderContactEdit({ gatedFields: ["iban", "bic"], pendingChangesAnswered });
    fireEvent.change(input("iban"), { target: { value: NEW_IBAN } });
    await act(async () => answerPendingChanges());
    await rtlScreen.findByTestId("field-approval-request-bic");

    expect(input("bic").disabled).toBe(true);
    expect(input("iban").disabled).toBe(false);
    fireEvent.change(input("iban"), { target: { value: OLD_IBAN } });
    expect(input("iban").disabled).toBe(true);
  });

  test("a gated field the layout makes read-only offers no request", async () => {
    renderContactEdit({
      gatedFields: ["iban", "bic"],
      screen: {
        ...editScreen,
        layout: {
          sections: [
            {
              title: "Main",
              fields: ["name", { field: "iban", readOnly: { field: "name", eq: "Owner" } }, "bic"],
            },
          ],
        },
      },
    });
    await rtlScreen.findByTestId("field-approval-request-bic");

    expect(rtlScreen.queryByTestId("field-approval-request-iban")).toBeNull();
  });

  test("the drawer files and reports nothing while no field has changed", async () => {
    const { batches, notices } = renderContactEdit({ gatedFields: ["iban"] });
    const drawer = await openDrawer();
    const submit = within(drawer).getByTestId("render-edit-submit") as HTMLButtonElement;

    expect(submit.disabled).toBe(true);
    await act(async () => {
      fireEvent.submit(submit.form as HTMLFormElement);
    });
    expect(batches).toEqual([]);
    expect(notices).toEqual([]);
    expect(rtlScreen.getByTestId(DRAWER)).toBe(drawer);
  });
});

describe("RenderEdit — open approval request", () => {
  test("a freshly loaded form shows the open request at its field without any edit", async () => {
    const { queries } = renderContactEdit({
      openRequests: [{ id: "fcr-1", version: 1, fieldName: "iban" }],
    });

    const hint = await rtlScreen.findByText("Awaiting approval");
    expect(rtlScreen.getByTestId("field-kumiko-edit-iban").contains(hint)).toBe(true);
    expect(rtlScreen.getAllByText("Awaiting approval")).toHaveLength(1);
    expect(input("iban").value).toBe(OLD_IBAN);
    expect(queries).toContainEqual({
      type: PENDING_CHANGES,
      payload: { entityType: "contact", entityId: "c1" },
    });
  });

  test("only the requester sees the withdraw action, which rejects the request and asks again", async () => {
    const { writes, queries } = renderContactEdit({
      gatedFields: ["iban", "bic"],
      openRequests: [
        { id: "fcr-1", version: 3, fieldName: "iban", value: NEW_IBAN, filedByCaller: true },
        { id: "fcr-2", version: 1, fieldName: "bic", value: "COBADEFFXXX", filedByCaller: false },
      ],
    });

    const withdraw = await rtlScreen.findByTestId("field-approval-withdraw-iban");
    expect(rtlScreen.queryByTestId("field-approval-withdraw-bic")).toBeNull();
    expect(rtlScreen.queryByTestId("field-approval-request-iban")).toBeNull();
    expect(rtlScreen.getByTestId("field-approval-request-bic").textContent).toBe("Request change");
    fireEvent.click(withdraw);

    await waitFor(() =>
      expect(writes.filter((w) => w.type === REJECT_CHANGE)).toEqual([
        { type: REJECT_CHANGE, payload: { id: "fcr-1", version: 3 } },
      ]),
    );
    await waitFor(() => expect(queries.filter((q) => q.type === PENDING_CHANGES)).toHaveLength(2));
  });

  test("a reopened form names the requested value while the field keeps the saved one", async () => {
    renderContactEdit({
      openRequests: [{ id: "fcr-1", version: 1, fieldName: "iban", value: NEW_IBAN }],
    });

    const hint = await rtlScreen.findByText(`Requested: ${NEW_IBAN} · awaiting approval`);
    expect(rtlScreen.getByTestId("field-kumiko-edit-iban").contains(hint)).toBe(true);
    expect(input("iban").value).toBe(OLD_IBAN);
    expect(rtlScreen.queryByText("Awaiting approval")).toBeNull();
  });

  test("a writeOnly field shows only that a request is open, never a value", async () => {
    renderContactEdit({
      openRequests: [{ id: "fcr-1", version: 1, fieldName: "accessPin", value: true }],
      screen: editScreenWithAccessPin,
    });

    const hint = await rtlScreen.findByText("Awaiting approval");
    expect(rtlScreen.getByTestId("field-kumiko-edit-accessPin").contains(hint)).toBe(true);
    expect(rtlScreen.queryByText(/Requested:/)).toBeNull();
  });

  test("a reference field never shows the raw record id as the requested value", async () => {
    renderContactEdit({
      openRequests: [{ id: "fcr-1", version: 1, fieldName: "manager", value: MANAGER_ID }],
      screen: editScreenWithManagerAndNotes,
    });

    const hint = await rtlScreen.findByText("Awaiting approval");
    expect(rtlScreen.getByTestId("field-kumiko-edit-manager").contains(hint)).toBe(true);
    expect(rtlScreen.queryByText(new RegExp(MANAGER_ID))).toBeNull();
  });

  test("a document field names the requested value as plain text, not HTML", async () => {
    renderContactEdit({
      openRequests: [
        { id: "fcr-1", version: 1, fieldName: "notes", value: "<p>New <strong>text</strong></p>" },
      ],
      screen: editScreenWithManagerAndNotes,
    });

    const hint = await rtlScreen.findByText("Requested: New text · awaiting approval");
    expect(rtlScreen.getByTestId("field-kumiko-edit-notes").contains(hint)).toBe(true);
  });

  test("without the field-approval feature the form asks for no open requests", async () => {
    const { queries } = renderContactEdit({
      features: [],
      openRequests: [{ id: "fcr-1", version: 1, fieldName: "iban" }],
    });
    await rtlScreen.findByLabelText("iban");

    expect(queries.filter((q) => q.type === PENDING_CHANGES)).toEqual([]);
    expect(rtlScreen.queryByText("Awaiting approval")).toBeNull();
  });
});
