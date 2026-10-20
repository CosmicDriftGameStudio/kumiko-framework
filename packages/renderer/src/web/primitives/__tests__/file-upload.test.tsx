import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import type { PickedFile } from "../../../index.ts";
import { render } from "../../__tests__/test-utils.tsx";
import { FileUploadInput } from "../file-upload.tsx";
import { defaultPrimitives } from "../index.tsx";

const noop = () => {};
const FILE_ID = "11111111-2222-4333-8444-555555555555";

// alt="" makes the <img> presentational (no accessible role), so
// getByRole("img") wouldn't find it — query the DOM directly instead.
describe("FileUploadInput — image variant preview src (#1950)", () => {
  test("with imageVariant set, the <img> src requests the named variant", () => {
    const { container } = render(
      <FileUploadInput
        kind="image"
        id="avatar"
        value={FILE_ID}
        onChange={noop}
        imageVariant="thumb"
      />,
    );
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      `/api/files/${FILE_ID}/variant/thumb`,
    );
  });

  test("without imageVariant, the <img> src loads the original", () => {
    const { container } = render(
      <FileUploadInput kind="image" id="avatar" value={FILE_ID} onChange={noop} />,
    );
    expect(container.querySelector("img")?.getAttribute("src")).toBe(`/api/files/${FILE_ID}`);
  });
});

describe("FileUploadInput — camera capture (#1953)", () => {
  test("with capture set, the <input type=file> carries the capture attribute", () => {
    const { container } = render(
      <FileUploadInput
        kind="image"
        id="avatar"
        value={null}
        onChange={noop}
        capture="environment"
      />,
    );
    expect(container.querySelector('input[type="file"]')?.getAttribute("capture")).toBe(
      "environment",
    );
  });

  test("without capture, the <input type=file> has no capture attribute", () => {
    const { container } = render(
      <FileUploadInput kind="image" id="avatar" value={null} onChange={noop} />,
    );
    expect(container.querySelector('input[type="file"]')?.hasAttribute("capture")).toBe(false);
  });
});

describe("FileUploadInput — directory mode", () => {
  test("directory sets webkitdirectory + multiple and hands the files to onFilesPicked", () => {
    const picked: File[][] = [];
    const { container } = render(
      <FileUploadInput
        kind="file"
        id="folder"
        value={null}
        onChange={noop}
        directory
        onFilesPicked={(files) => picked.push([...files])}
      />,
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (input === null) throw new Error("file input missing");
    expect(input.hasAttribute("webkitdirectory")).toBe(true);
    expect(input.multiple).toBe(true);
    const file = new File(["x"], "a.txt");
    Object.defineProperty(file, "webkitRelativePath", { value: "dir/a.txt" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(picked).toHaveLength(1);
    expect(picked[0]?.[0]?.webkitRelativePath).toBe("dir/a.txt");
  });

  test("without directory the input has no webkitdirectory", () => {
    const { container } = render(
      <FileUploadInput kind="file" id="f" value={null} onChange={noop} />,
    );
    expect(container.querySelector('input[type="file"]')?.hasAttribute("webkitdirectory")).toBe(
      false,
    );
  });
});

describe("Input kind=file — folder picker through the primitive", () => {
  test("directory + pickLabel + testId: labelled button, derived testIds, files delivered, no upload", () => {
    const Input = defaultPrimitives.Input;
    const picked: (readonly PickedFile[])[] = [];
    const fetchSpy = spyOn(globalThis, "fetch");
    const { getByTestId, getByText } = render(
      <Input
        kind="file"
        id="folder"
        name="folder"
        value={null}
        onChange={noop}
        directory
        pickLabel="Choose folder"
        testId="studio-folder"
        onFilesPicked={(files) => picked.push(files)}
      />,
    );
    expect(getByText("Choose folder")).toBeTruthy();
    expect(getByTestId("studio-folder-pick")).toBeTruthy();
    const input = getByTestId("studio-folder-input");
    expect(input.hasAttribute("webkitdirectory")).toBe(true);
    const file = new File(["x"], "a.txt");
    Object.defineProperty(file, "webkitRelativePath", { value: "dir/a.txt" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(picked[0]?.[0]?.webkitRelativePath).toBe("dir/a.txt");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("FileUploadInput — translated labels", () => {
  test("buttons and the attached hint use the locale strings", () => {
    const { getByRole, getByText } = render(
      <FileUploadInput kind="file" id="doc" value={FILE_ID} onChange={noop} />,
    );
    expect(getByRole("button", { name: "Change" })).toBeDefined();
    expect(getByRole("button", { name: "Remove" })).toBeDefined();
    expect(getByText("File attached")).toBeDefined();
  });
});

describe("FileUploadInput — upload POST body", () => {
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | undefined;

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  async function pickFileAndReadPostedBody(props: {
    readonly entityId?: string;
  }): Promise<FormData> {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "new-file" }), { status: 200 }),
    );
    const uploaded: (string | null)[] = [];
    const { container } = render(
      <FileUploadInput
        kind="file"
        id="doc"
        value={null}
        onChange={(id) => uploaded.push(id)}
        entityType="order"
        fieldName="doc"
        {...props}
      />,
    );
    const input = container.querySelector('input[type="file"]');
    if (input === null) throw new Error("file input missing");
    fireEvent.change(input, {
      target: { files: [new File(["x"], "a.txt", { type: "text/plain" })] },
    });
    await waitFor(() => expect(uploaded).toEqual(["new-file"]));
    const body = fetchSpy.mock.calls[0]?.[1]?.body;
    if (!(body instanceof FormData)) throw new Error("expected a FormData body");
    return body;
  }

  test("posts entityId next to entityType/fieldName when the prop is set", async () => {
    const body = await pickFileAndReadPostedBody({ entityId: "rec-1" });
    expect(body.get("entityId")).toBe("rec-1");
    expect(body.get("entityType")).toBe("order");
    expect(body.get("fieldName")).toBe("doc");
  });

  test("posts no entityId part without the prop", async () => {
    const body = await pickFileAndReadPostedBody({});
    expect(body.has("entityId")).toBe(false);
    expect(body.get("entityType")).toBe("order");
  });
});

describe("FileUploadInput — upload failure", () => {
  afterEach(() => {
    fetchSpy?.mockRestore();
  });
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | undefined;

  test("shows the translated text for a server error code, never the raw server string", async () => {
    const rawServerMessage = "file_too_large: 12 bytes exceeds the limit of 10";
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: rawServerMessage }), { status: 413 }),
    );
    const { container, findByText, queryByText } = render(
      <FileUploadInput
        kind="file"
        id="doc"
        value={null}
        onChange={noop}
        uploadActionForm="rental:screen:upload"
        fieldName="doc"
      />,
    );
    const input = container.querySelector('input[type="file"]');
    if (input === null) throw new Error("file input missing");
    fireEvent.change(input, { target: { files: [new File(["x"], "a.txt")] } });
    expect(await findByText("File is too large")).toBeDefined();
    expect(queryByText(rawServerMessage, { exact: false })).toBeNull();
  });
});
