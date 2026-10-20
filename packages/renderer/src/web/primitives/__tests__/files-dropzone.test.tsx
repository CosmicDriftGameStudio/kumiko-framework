import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { render } from "../../__tests__/test-utils.tsx";
import { FilesDropzoneInput } from "../files-dropzone.tsx";

const SCREEN = "rental:screen:upload-standard-layout";

type Reply = { readonly status: number; readonly body: Record<string, unknown> };

let nextReplies: Reply[];
let requests: FormData[];

beforeEach(() => {
  nextReplies = [];
  requests = [];
  spyOn(globalThis, "fetch").mockImplementation((async (_url: unknown, init?: RequestInit) => {
    requests.push(init?.body as FormData);
    const reply = nextReplies.shift() ?? { status: 201, body: { id: crypto.randomUUID() } };
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  }) as typeof fetch);
});

afterEach(() => {
  (globalThis.fetch as unknown as { mockRestore(): void }).mockRestore();
});

function Harness({
  maxCount,
  onValue,
  resetRef,
}: {
  readonly maxCount?: number;
  readonly onValue: (value: readonly string[]) => void;
  readonly resetRef: { current: () => void };
}): ReactNode {
  const [value, setValue] = useState<readonly string[]>([]);
  resetRef.current = () => setValue([]);
  return (
    <FilesDropzoneInput
      id="belege"
      testId="zone"
      value={value}
      onChange={(next) => {
        setValue(next);
        onValue(next);
      }}
      accept={["pdf", "png"]}
      {...(maxCount !== undefined && { maxCount })}
      uploadActionForm={SCREEN}
      fieldName="belege"
    />
  );
}

function pick(files: readonly File[]): void {
  const input = document.querySelector('[data-testid="zone-input"]') as HTMLInputElement;
  Object.defineProperty(input, "files", { value: files, configurable: true });
  fireEvent.change(input);
}

const pdf = (name: string) => new File(["%PDF"], name, { type: "application/pdf" });

function mount(maxCount?: number) {
  const values: (readonly string[])[] = [];
  const resetRef = { current: () => {} };
  const utils = render(
    <Harness
      onValue={(v) => values.push(v)}
      resetRef={resetRef}
      {...(maxCount !== undefined && { maxCount })}
    />,
  );
  return { ...utils, values, resetRef };
}

describe("FilesDropzoneInput", () => {
  test("uploads to the actionForm screen (not an entityType) and collects every id of the batch", async () => {
    const { values } = mount();
    nextReplies = [
      { status: 201, body: { id: "id-a" } },
      { status: 201, body: { id: "id-b" } },
    ];

    pick([pdf("a.pdf"), pdf("b.pdf")]);

    await waitFor(() => expect(values.at(-1)).toEqual(["id-a", "id-b"]));
    for (const body of requests) {
      expect(body.get("actionForm")).toBe(SCREEN);
      expect(body.get("fieldName")).toBe("belege");
      expect(body.has("entityType")).toBe(false);
    }
  });

  test("removing a row drops its id from the value", async () => {
    const { values, getAllByTestId, queryByText } = mount();
    nextReplies = [
      { status: 201, body: { id: "id-a" } },
      { status: 201, body: { id: "id-b" } },
    ];
    pick([pdf("a.pdf"), pdf("b.pdf")]);
    await waitFor(() => expect(values.at(-1)).toEqual(["id-a", "id-b"]));

    fireEvent.click(getAllByTestId("zone-remove")[0] as HTMLElement);

    await waitFor(() => expect(values.at(-1)).toEqual(["id-b"]));
    expect(queryByText("a.pdf")).toBeNull();
  });

  test("an external reset clears the value and every row", async () => {
    const { values, resetRef, queryByText, getByText } = mount();
    pick([pdf("a.pdf")]);
    await waitFor(() => expect(values.at(-1)).toHaveLength(1));
    expect(getByText("a.pdf")).toBeTruthy();

    act(() => resetRef.current());

    await waitFor(() => expect(queryByText("a.pdf")).toBeNull());
  });

  test("a server error code shows translated text, not the server string, and adds no id", async () => {
    const { values, getByText, queryByText } = mount();
    nextReplies = [
      { status: 400, body: { error: "file_too_large: 12 MB exceeds the 10 MB limit" } },
    ];

    pick([pdf("huge.pdf")]);

    await waitFor(() => expect(getByText("File is too large")).toBeTruthy());
    expect(queryByText(/12 MB/)).toBeNull();
    expect(values).toEqual([]);
  });

  test("a file of the wrong type is refused on the client with the type message", async () => {
    const { getByText } = mount();

    pick([new File(["x"], "Mietvertrag.docx")]);

    await waitFor(() => expect(getByText("File type not allowed")).toBeTruthy());
    expect(requests).toEqual([]);
  });

  test("maxCount refuses further files", async () => {
    const { values, getByText } = mount(1);

    pick([pdf("a.pdf"), pdf("b.pdf")]);

    await waitFor(() => expect(getByText("At most 1 files")).toBeTruthy());
    expect(values.at(-1)).toHaveLength(1);
    expect(requests).toHaveLength(1);
  });
});
