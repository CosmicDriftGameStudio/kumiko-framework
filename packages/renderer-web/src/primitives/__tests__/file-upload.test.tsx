import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { FileUploadInput } from "../file-upload";

const noop = () => {};

// alt="" makes the <img> presentational (no accessible role), so
// getByRole("img") wouldn't find it — query the DOM directly instead.
describe("FileUploadInput — image variant preview src (#1950)", () => {
  test("with imageVariant set, the <img> src requests the named variant", () => {
    const { container } = render(
      <FileUploadInput kind="image" id="avatar" value="abc" onChange={noop} imageVariant="thumb" />,
    );
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "/api/files/abc/variant/thumb",
    );
  });

  test("without imageVariant, the <img> src loads the original", () => {
    const { container } = render(
      <FileUploadInput kind="image" id="avatar" value="abc" onChange={noop} />,
    );
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/api/files/abc");
  });
});
