import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
  FeatureSchema,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { fireEvent, render, screen as rtlScreen, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { type RecordedWrite, stubDispatcher } from "../../__tests__/stub-dispatcher.ts";
import { AppFeaturesProvider } from "../../app/app-features-context.tsx";
import { type ActionNotice, ActionNoticeProvider } from "../../app/client-actions.tsx";
import { DispatcherProvider } from "../../context/dispatcher-context.tsx";
import type { WriteResult } from "../../headless/index.ts";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.tsx";
import { kumikoDefaultTranslations } from "../../i18n-defaults.ts";
import { mapServerError } from "../../live/error-mapping.ts";
import {
  type BannerProps,
  type ButtonProps,
  type FieldProps,
  type FormProps,
  type InputProps,
  PrimitivesProvider,
  type TextProps,
} from "../../primitives.tsx";
import { createStubPrimitives } from "../../testing.ts";
import { RenderEdit } from "../render-edit.tsx";

type Values = { name: string; iban: string };

const OLD_IBAN = "DE02120300000000202051";
const NEW_IBAN = "DE89370400440532013000";
const UPDATE = "contacts:write:contact:update";
const REQUEST_CHANGE = "field-approval:write:request-change";
const PENDING_CHANGES = "field-approval:query:pending-changes";

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
      onChange={(e) => props.onChange(e.target.value)}
    />
  ) : null;

const testField: ComponentType<FieldProps> = ({ id, description, status, issues, children }) => (
  <div data-testid={`field-${id}`}>
    {status !== undefined ? <span data-tone={status.tone}>{status.label}</span> : null}
    {children}
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

const entity: EntityDefinition = {
  name: "contact",
  fields: {
    name: { type: "text", allowPlaintext: "test fixture", maxLength: 64 },
    iban: { type: "text", allowPlaintext: "test fixture", maxLength: 34 },
  },
};

const editScreen: EntityEditScreenDefinition = {
  id: "contact-edit",
  type: "entityEdit",
  entity: "contact",
  layout: { sections: [{ title: "Main", fields: ["name", "iban"] }] },
};

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

type RecordedQuery = { readonly type: string; readonly payload: unknown };

function renderContactEdit(
  features: readonly FeatureSchema[],
  notices: ActionNotice[] = [],
  openRequests: readonly { readonly fieldName: string }[] = [],
  queries: RecordedQuery[] = [],
): RecordedWrite[] {
  let updates = 0;
  const { dispatcher, writes } = stubDispatcher({
    query: (type, payload) => {
      queries.push({ type, payload });
      return { isSuccess: true, data: type === PENDING_CHANGES ? { rows: openRequests } : {} };
    },
    write: (type): WriteResult<unknown> => {
      if (type !== UPDATE) return { isSuccess: true, data: { id: "fcr-1" } };
      updates += 1;
      return updates === 1
        ? { isSuccess: false, error: approvalDenied }
        : { isSuccess: true, data: { id: "c1" } };
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
              })}
            >
              <RenderEdit<Values>
                screen={editScreen}
                entity={entity}
                featureName="contacts"
                entityId="c1"
                writeCommand={UPDATE}
                payloadMode="changes"
                initial={{ name: "Owner", iban: OLD_IBAN }}
              />
            </PrimitivesProvider>
          </ActionNoticeProvider>
        </DispatcherProvider>
      </AppFeaturesProvider>
    </LocaleProvider>,
  );
  return writes;
}

function input(name: string): HTMLInputElement {
  return rtlScreen.getByLabelText(name) as HTMLInputElement;
}

async function editAndSave(): Promise<void> {
  fireEvent.change(input("name"), { target: { value: "Owner GmbH" } });
  fireEvent.change(input("iban"), { target: { value: NEW_IBAN } });
  fireEvent.click(rtlScreen.getByTestId("render-edit-submit"));
  await waitFor(() => rtlScreen.getByTestId("render-edit-form-error"));
}

describe("RenderEdit — field approval required", () => {
  test("the banner names the gated field and every input is kept", async () => {
    renderContactEdit([fieldApprovalSchema]);
    await editAndSave();

    expect(rtlScreen.getByTestId("render-edit-field-approval-fields").textContent).toContain(
      "IBAN",
    );
    expect(input("name").value).toBe("Owner GmbH");
    expect(input("iban").value).toBe(NEW_IBAN);
  });

  test("says it once: one warning sentence in the banner, the field marked without an error text", async () => {
    renderContactEdit([fieldApprovalSchema]);
    await editAndSave();

    const banner = rtlScreen.getByTestId("render-edit-form-error");
    expect(banner.dataset["variant"]).toBe("warning");
    expect(banner.textContent).toBe("Changes to IBAN need approval.Submit for approval");
    expect(rtlScreen.queryByTestId("field-kumiko-edit-iban-issue")).toBeNull();
    const marker = rtlScreen.getByText("Needs approval");
    expect(marker.dataset["tone"]).toBe("warn");
    expect(rtlScreen.getByTestId("field-kumiko-edit-iban").contains(marker)).toBe(true);
  });

  test("submit for approval files exactly the gated field and saves the rest", async () => {
    const writes = renderContactEdit([fieldApprovalSchema]);
    await editAndSave();

    fireEvent.click(rtlScreen.getByTestId("render-edit-field-approval-submit"));
    await waitFor(() => expect(writes.filter((w) => w.type === UPDATE)).toHaveLength(2));

    expect(writes.filter((w) => w.type === REQUEST_CHANGE)).toEqual([
      {
        type: REQUEST_CHANGE,
        payload: { entityType: "contact", entityId: "c1", fieldName: "iban", value: NEW_IBAN },
      },
    ]);
    const saved = JSON.stringify(writes.filter((w) => w.type === UPDATE)[1]?.payload);
    expect(saved).toContain("Owner GmbH");
    expect(saved).not.toContain(NEW_IBAN);
    await waitFor(() => expect(input("iban").value).toBe(OLD_IBAN));
    const hint = rtlScreen.getByText("Awaiting approval");
    expect(hint.parentElement?.contains(input("iban"))).toBe(true);
    expect(rtlScreen.getAllByText("Awaiting approval")).toHaveLength(1);
    expect(rtlScreen.queryByText("Needs approval")).toBeNull();
  });

  test("submitting for approval confirms through the action notifier", async () => {
    const notices: ActionNotice[] = [];
    renderContactEdit([fieldApprovalSchema], notices);
    await editAndSave();

    fireEvent.click(rtlScreen.getByTestId("render-edit-field-approval-submit"));
    await waitFor(() =>
      expect(notices).toEqual([{ tone: "success", text: "Submitted for approval" }]),
    );
  });

  test("without the field-approval feature only the hint shows, no action", async () => {
    renderContactEdit([]);
    await editAndSave();

    expect(rtlScreen.getByTestId("render-edit-form-error").textContent).toBe(
      "Changes to IBAN need approval.",
    );
    expect(rtlScreen.queryByTestId("render-edit-field-approval-submit")).toBeNull();
  });
});

describe("RenderEdit — open approval request", () => {
  test("a freshly loaded form shows the open request at its field without any edit", async () => {
    const queries: RecordedQuery[] = [];
    renderContactEdit([fieldApprovalSchema], [], [{ fieldName: "iban" }], queries);

    const hint = await rtlScreen.findByText("Awaiting approval");
    expect(rtlScreen.getByTestId("field-kumiko-edit-iban").contains(hint)).toBe(true);
    expect(rtlScreen.getAllByText("Awaiting approval")).toHaveLength(1);
    expect(input("iban").value).toBe(OLD_IBAN);
    expect(queries).toContainEqual({
      type: PENDING_CHANGES,
      payload: { entityType: "contact", entityId: "c1" },
    });
  });

  test("without the field-approval feature the form asks for no open requests", async () => {
    const queries: RecordedQuery[] = [];
    renderContactEdit([], [], [{ fieldName: "iban" }], queries);
    await rtlScreen.findByLabelText("iban");

    expect(queries.filter((q) => q.type === PENDING_CHANGES)).toEqual([]);
    expect(rtlScreen.queryByText("Awaiting approval")).toBeNull();
  });
});
