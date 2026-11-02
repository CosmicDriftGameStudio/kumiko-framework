import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { fireEvent, waitFor } from "@testing-library/react";
import type { FormValues } from "../../headless/index.ts";
import { RenderEdit } from "../../index.ts";
import { render, screen } from "./test-utils.tsx";

const entity = {
  fields: {
    name: { type: "text" },
    belege: { type: "files", display: "dropzone" },
    scan: { type: "file" },
  },
} as unknown as EntityDefinition;

const editScreen: EntityEditScreenDefinition = {
  id: "claims:screen:claim-edit",
  type: "entityEdit",
  entity: "claim",
  layout: { sections: [{ fields: ["name", "belege", "scan"] }] },
};

type Deferred = {
  readonly resolve: (id: string) => void;
  readonly reject: () => void;
};

let pendingUploads: Deferred[];
let submitted: FormValues[];

beforeEach(() => {
  pendingUploads = [];
  submitted = [];
  spyOn(globalThis, "fetch").mockImplementation((() => {
    return new Promise<Response>((resolve) => {
      pendingUploads.push({
        resolve: (id) => resolve(new Response(JSON.stringify({ id }), { status: 201 })),
        reject: () => resolve(new Response(JSON.stringify({}), { status: 500 })),
      });
    });
  }) as unknown as typeof fetch);
});

afterEach(() => {
  (globalThis.fetch as unknown as { mockRestore(): void }).mockRestore();
});

function mountForm() {
  return render(
    <RenderEdit
      screen={editScreen}
      entity={entity}
      featureName="claims"
      initial={{ name: "", belege: [], scan: null }}
      customSubmit={async (snapshot) => {
        submitted.push(snapshot.values);
        return { isSuccess: true, validationBlocked: false, data: undefined };
      }}
    />,
  );
}

function submitButton(): HTMLButtonElement {
  return screen.getByTestId("render-edit-submit") as HTMLButtonElement;
}

function makeDirty(): void {
  const input = screen.getByTestId("field-name").querySelector("input") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "Claim" } });
}

function pickFile(fieldTestId: string): void {
  const input = screen.getByTestId(fieldTestId).querySelector('input[type="file"]');
  if (input === null) throw new Error(`no file input in ${fieldTestId}`);
  Object.defineProperty(input, "files", {
    value: [new File(["%PDF"], "a.pdf", { type: "application/pdf" })],
    configurable: true,
  });
  fireEvent.change(input);
}

function submitForm(): void {
  fireEvent.submit(screen.getByTestId("render-edit-form"));
}

describe("RenderEdit holds back submit while an upload runs", () => {
  test("dropzone upload disables submit and blocks a native form submit until the file id is in the payload", async () => {
    mountForm();
    makeDirty();
    await waitFor(() => expect(submitButton().disabled).toBe(false));

    pickFile("field-belege");
    await waitFor(() => expect(pendingUploads).toHaveLength(1));
    await waitFor(() => expect(submitButton().disabled).toBe(true));

    submitForm();
    await Promise.resolve();
    expect(submitted).toHaveLength(0);

    pendingUploads[0]?.resolve("file-1");
    await waitFor(() => expect(submitButton().disabled).toBe(false));
    submitForm();

    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submittedValue("belege")).toEqual(["file-1"]);
  });

  test("a failed upload releases the lock", async () => {
    mountForm();
    makeDirty();
    pickFile("field-belege");
    await waitFor(() => expect(submitButton().disabled).toBe(true));

    pendingUploads[0]?.reject();

    await waitFor(() => expect(submitButton().disabled).toBe(false));
    submitForm();
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submittedValue("belege")).toEqual([]);
  });

  test("a single-file upload locks submit too", async () => {
    mountForm();
    makeDirty();
    pickFile("field-scan");
    await waitFor(() => expect(submitButton().disabled).toBe(true));

    submitForm();
    await Promise.resolve();
    expect(submitted).toHaveLength(0);

    pendingUploads[0]?.resolve("file-2");
    await waitFor(() => expect(submitButton().disabled).toBe(false));
    submitForm();
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submittedValue("scan")).toBe("file-2");
  });
});

function submittedValue(field: string): unknown {
  return submitted[0]?.[field];
}
