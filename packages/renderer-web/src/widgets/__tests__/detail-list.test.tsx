import { describe, expect, test } from "bun:test";
import { render, screen } from "../../__tests__/test-utils";
import { DetailList } from "../detail-list";

describe("DetailList", () => {
  test("sizes the label column from the container, not the viewport", () => {
    render(<DetailList rows={[{ label: "Name", value: "Acme" }]} testId="dl" />);

    const dl = screen.getByTestId("dl");
    expect(dl.className.split(" ")).toContain("@container");

    const row = screen.getByText("Name").parentElement;
    const rowClasses = row?.className.split(" ") ?? [];
    expect(rowClasses).toContain("@md:grid-cols-[200px_1fr]");
    expect(rowClasses).toContain("@md:gap-4");
    expect(rowClasses).not.toContain("sm:grid-cols-[200px_1fr]");
    expect(rowClasses).not.toContain("sm:gap-4");
  });
});
