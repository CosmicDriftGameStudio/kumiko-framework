import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup } from "@testing-library/react";
import { fireEvent, render, screen } from "../../__tests__/test-utils.tsx";
import { FilePickButton } from "../file-pick-button.tsx";

afterEach(cleanup);

describe("FilePickButton", () => {
  test("accept and multiple reach the hidden input", () => {
    render(
      <FilePickButton onFilesPicked={() => {}} accept={["pdf", "text/csv"]} multiple testId="pick">
        Choose
      </FilePickButton>,
    );
    const input = screen.getByTestId("pick-input");
    expect(input.getAttribute("accept")).toBe(".pdf,text/csv");
    expect(input.hasAttribute("multiple")).toBe(true);
  });

  test("a picked file is handed to onFilesPicked", () => {
    const onFilesPicked = mock((_files: readonly File[]) => {});
    render(
      <FilePickButton onFilesPicked={onFilesPicked} testId="pick">
        Choose
      </FilePickButton>,
    );
    const file = new File(["a"], "a.csv");
    fireEvent.change(screen.getByTestId("pick-input"), { target: { files: [file] } });
    expect(onFilesPicked).toHaveBeenCalledTimes(1);
    expect(onFilesPicked.mock.calls[0]?.[0]).toEqual([file]);
  });

  test("an empty selection does not call onFilesPicked", () => {
    const onFilesPicked = mock((_files: readonly File[]) => {});
    render(
      <FilePickButton onFilesPicked={onFilesPicked} testId="pick">
        Choose
      </FilePickButton>,
    );
    fireEvent.change(screen.getByTestId("pick-input"), { target: { files: [] } });
    expect(onFilesPicked).not.toHaveBeenCalled();
  });

  test("clicking the button clicks the hidden input", () => {
    render(
      <FilePickButton onFilesPicked={() => {}} testId="pick">
        Choose
      </FilePickButton>,
    );
    const spy = mock(() => {});
    screen.getByTestId("pick-input").addEventListener("click", spy);
    fireEvent.click(screen.getByTestId("pick"));
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
