import { describe, expect, mock, test } from "bun:test";
import {
  createStaticLocaleResolver,
  LocaleProvider,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer-web";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { CustomFieldsFormSection } from "../custom-fields-form-section";
import { defaultTranslations } from "../i18n";

type FieldRow = {
  id: string;
  entityName: string;
  fieldKey: string;
  type: string;
  required: boolean;
  displayOrder: number;
};

const dispatchSpy = mock(async () => ({ isSuccess: true, data: undefined }));
let mockedQueryRows: readonly FieldRow[] = [];

const useQuerySpy = mock((_type: string, _params: unknown, _options?: { enabled?: boolean }) => ({
  data: { rows: mockedQueryRows },
  loading: false,
  error: null,
  refetch: mock(),
}));

const actual_renderer = await import("@cosmicdrift/kumiko-renderer");
mock.module("@cosmicdrift/kumiko-renderer", () => ({
  ...actual_renderer,
  useDispatcher: mock(() => ({
    write: dispatchSpy,
    query: mock(),
    batch: mock(),
  })),
  useQuery: useQuerySpy,
}));

function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <LocaleProvider resolver={createStaticLocaleResolver()} fallbackBundles={[defaultTranslations]}>
      <PrimitivesProvider value={defaultPrimitives}>{children}</PrimitivesProvider>
    </LocaleProvider>
  );
}

describe("CustomFieldsFormSection", () => {
  test("renders an input per matching fieldDefinition and dispatches set-custom-field on save", async () => {
    mockedQueryRows = [
      {
        id: "f1",
        entityName: "component",
        fieldKey: "vendor",
        type: "text",
        required: false,
        displayOrder: 1,
      },
      {
        id: "f2",
        entityName: "component",
        fieldKey: "tier",
        type: "number",
        required: false,
        displayOrder: 2,
      },
      {
        id: "f3",
        entityName: "incident",
        fieldKey: "rootCause",
        type: "text",
        required: false,
        displayOrder: 1,
      },
    ];
    dispatchSpy.mockClear();

    render(
      <Wrapper>
        <CustomFieldsFormSection entityName="component" entityId="row-42" />
      </Wrapper>,
    );

    // Only `component`-entity fields are rendered (incident's rootCause filtered out).
    expect(screen.getByTestId("custom-fields-form-section")).toBeTruthy();
    const vendorInput = document.getElementById("custom-field-vendor") as HTMLInputElement;
    const tierInput = document.getElementById("custom-field-tier") as HTMLInputElement;
    expect(vendorInput).toBeTruthy();
    expect(tierInput).toBeTruthy();
    expect(document.getElementById("custom-field-rootCause")).toBeNull();

    // Type in vendor; tier left empty (should be skipped on save).
    fireEvent.change(vendorInput, { target: { value: "Hetzner" } });

    const saveBtn = screen.getByTestId("custom-fields-form-save");
    fireEvent.click(saveBtn);
    // Wait one microtask for the async handleSave loop.
    await Promise.resolve();
    await Promise.resolve();

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).toHaveBeenCalledWith("custom-fields:write:set-custom-field", {
      entityName: "component",
      entityId: "row-42",
      fieldKey: "vendor",
      value: "Hetzner",
    });
  });

  test("shows create-mode banner when entityId is null and skips the fieldDefinition query", () => {
    mockedQueryRows = [];
    useQuerySpy.mockClear();

    render(
      <Wrapper>
        <CustomFieldsFormSection entityName="component" entityId={null} />
      </Wrapper>,
    );

    const banner = screen.getByTestId("custom-fields-form-create-mode");
    expect(banner).toBeTruthy();
    expect(screen.queryByTestId("custom-fields-form-section")).toBeNull();
    // The banner shows the translated string, not the raw i18n key.
    expect(banner.textContent).toBe("Save the entity first to add custom field values.");
    // create-mode discards the query result via the early return, so the
    // fetch-on-mount must be disabled — no wasted server roundtrip.
    expect(useQuerySpy.mock.calls[0]?.[2]).toEqual({ enabled: false });
  });

  test("shows empty banner when no fieldDefinitions match entityName", () => {
    mockedQueryRows = [
      {
        id: "f3",
        entityName: "incident",
        fieldKey: "rootCause",
        type: "text",
        required: false,
        displayOrder: 1,
      },
    ];

    render(
      <Wrapper>
        <CustomFieldsFormSection entityName="component" entityId="row-42" />
      </Wrapper>,
    );

    const banner = screen.getByTestId("custom-fields-form-empty");
    expect(banner).toBeTruthy();
    expect(screen.queryByTestId("custom-fields-form-section")).toBeNull();
    // Translated + interpolated with the host entity name, not the raw key.
    expect(banner.textContent).toBe('No custom fields defined for "component".');
  });

  test("save button renders the translated label, not the raw i18n key", () => {
    mockedQueryRows = [
      {
        id: "f1",
        entityName: "component",
        fieldKey: "vendor",
        type: "text",
        required: false,
        displayOrder: 1,
      },
    ];

    render(
      <Wrapper>
        <CustomFieldsFormSection entityName="component" entityId="row-42" />
      </Wrapper>,
    );

    const saveBtn = screen.getByTestId("custom-fields-form-save");
    expect(saveBtn.textContent).toBe("Save custom fields");
  });
});
