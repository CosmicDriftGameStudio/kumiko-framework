import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { act, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import {
  AppFeaturesProvider,
  DispatcherProvider,
  type FeatureSchema,
  RenderList,
} from "../../index.ts";
import { clearFileMetaCache } from "../primitives/file-thumbnail.tsx";
import { createMockDispatcher, render } from "./test-utils.tsx";

// The meta cache is module-wide, so every test file uses its own ids.
const FILE_ID = "bbbbbbbb-3333-4444-8555-666666666666";
const DOCUMENT_ID = "cccccccc-4444-4555-8666-777777777777";
const LABEL = "Offer Miller";
const realFetch = globalThis.fetch;

beforeEach(() => {
  clearFileMetaCache();
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        files: [{ id: FILE_ID, fileName: "offer.pdf", mimeType: "application/pdf", size: 1 }],
      }),
      { status: 200 },
    )) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const offerEntity = {
  fields: {
    name: { type: "text" },
    receipt: { type: "reference", entity: "documents:filed-document", labelField: "title" },
  },
} as unknown as EntityDefinition;

const offerScreen: EntityListScreenDefinition = {
  id: "offer-list",
  type: "entityList",
  entity: "offer",
  columns: [{ field: "name" }, { field: "receipt" }],
};

function documentsFeature(fields: Record<string, { readonly type: string }>): FeatureSchema {
  return {
    featureName: "documents",
    entities: { "filed-document": { fields: { title: { type: "text" }, ...fields } } },
    screens: [],
  } as unknown as FeatureSchema;
}

const singleFileFeature = documentsFeature({ file: { type: "file" } });

async function renderReceiptCell(
  documentRow: Record<string, unknown>,
  feature: FeatureSchema = singleFileFeature,
): Promise<HTMLElement> {
  const dispatcher = createMockDispatcher({
    query: async () => ({ isSuccess: true, data: { rows: [documentRow] } }),
  });
  const ui: ReactElement = (
    <DispatcherProvider dispatcher={dispatcher}>
      <AppFeaturesProvider features={[feature]}>
        <RenderList
          screen={offerScreen}
          entity={offerEntity}
          featureName="offers"
          rows={[{ id: "o1", name: "Roof", receipt: DOCUMENT_ID }]}
        />
      </AppFeaturesProvider>
    </DispatcherProvider>
  );
  const view = render(ui);
  await act(async () => {});
  const cell = view.getByTestId("cell-o1-receipt");
  await waitFor(() => expect(cell.textContent).toContain(LABEL));
  return cell;
}

describe("reference column to an entity with one file field", () => {
  test("links the referenced file, the reference label is the link text", async () => {
    const cell = await renderReceiptCell({ id: DOCUMENT_ID, title: LABEL, file: FILE_ID });
    const anchor = cell.querySelector("a");
    expect(anchor?.getAttribute("href")).toBe(`/api/files/${FILE_ID}`);
    expect(anchor?.textContent).toBe(LABEL);
    expect(anchor?.getAttribute("aria-label")).toBe(`Download: ${LABEL}`);
  });

  test("offers the drawer view for a PDF like the documents list", async () => {
    const cell = await renderReceiptCell({ id: DOCUMENT_ID, title: LABEL, file: FILE_ID });
    await waitFor(() =>
      expect(cell.querySelector(`[data-testid="file-view-${FILE_ID}"]`)).not.toBeNull(),
    );
  });

  test.each([
    ["the referenced record has no file", { id: DOCUMENT_ID, title: LABEL, file: null }],
    // The list query leaves out a field the caller may not read.
    ["the caller may not read the file field", { id: DOCUMENT_ID, title: LABEL }],
    ["the file value is not a FileRef id", { id: DOCUMENT_ID, title: LABEL, file: true }],
  ] as const)("stays text when %s", async (_, documentRow) => {
    const cell = await renderReceiptCell(documentRow);
    expect(cell.textContent).toBe(LABEL);
    expect(cell.querySelector("a")).toBeNull();
  });

  test.each([
    ["two file fields", documentsFeature({ file: { type: "file" }, copy: { type: "file" } })],
    ["a multi-file field", documentsFeature({ file: { type: "files" } })],
    [
      "a file field beside a multi-file field",
      documentsFeature({ file: { type: "file" }, extras: { type: "files" } }),
    ],
  ] as const)("stays text when the target has %s", async (_, feature) => {
    const cell = await renderReceiptCell({ id: DOCUMENT_ID, title: LABEL, file: FILE_ID }, feature);
    expect(cell.textContent).toBe(LABEL);
    expect(cell.querySelector("a")).toBeNull();
  });
});
