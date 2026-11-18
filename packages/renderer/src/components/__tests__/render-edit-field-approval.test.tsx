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

const testField: ComponentType<FieldProps> = ({ description, children }) => (
  <div>
    {children}
    {description !== undefined ? <span>{description}</span> : null}
  </div>
);

const testBanner: ComponentType<BannerProps> = ({ children, actions, testId }) => (
  <div data-testid={testId}>
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

function renderContactEdit(features: readonly FeatureSchema[]): RecordedWrite[] {
  let updates = 0;
  const { dispatcher, writes } = stubDispatcher({
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

    const banner = rtlScreen.getByTestId("render-edit-form-error");
    expect(banner.textContent).toContain("This change needs approval.");
    expect(rtlScreen.getByTestId("render-edit-field-approval-fields").textContent).toContain(
      "IBAN",
    );
    expect(input("name").value).toBe("Owner GmbH");
    expect(input("iban").value).toBe(NEW_IBAN);
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
  });

  test("without the field-approval feature only the hint shows, no action", async () => {
    renderContactEdit([]);
    await editAndSave();

    expect(rtlScreen.getByTestId("render-edit-form-error").textContent).toContain(
      "This change needs approval.",
    );
    expect(rtlScreen.queryByTestId("render-edit-field-approval-submit")).toBeNull();
  });
});
