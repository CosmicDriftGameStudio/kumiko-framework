import { describe, expect, test } from "bun:test";
import { DefaultPhotoGrid } from "../primitives/photo-grid.tsx";
import { DefaultRecordSteps } from "../primitives/record-steps.tsx";
import { render, screen } from "./test-utils.tsx";

describe("record page board look", () => {
  test("photo grid is 2 columns on a phone and 3 from md, caption in foreground", () => {
    render(<DefaultPhotoGrid tiles={[{ id: "p1", caption: "Kitchen" }]} testId="pg" />);
    const grid = screen.getByTestId("pg");
    expect(grid.className).toContain("[grid-template-columns:repeat(2,minmax(0,1fr))]");
    expect(grid.className).toContain("md:[grid-template-columns:repeat(3,minmax(0,1fr))]");
    expect(grid.className).not.toContain("lg:[grid-template-columns:repeat(4");
    expect(screen.getByText("Kitchen").className).toContain("text-foreground");
    const thumb = screen.getByTestId("pg-tile-p1").querySelector('[class*="aspect-"]');
    expect(thumb?.className).toContain("aspect-[3/2]");
    expect(thumb?.className).toContain("md:aspect-[2/1]");
    expect(thumb?.className).toContain("object-cover");
  });

  test("next steps: no counter, more-actions get a label row below the main action", () => {
    render(
      <DefaultRecordSteps
        title="Next step"
        emptyLabel="none"
        reasonLabel="Why"
        moreActionsLabel="Or"
        count={1}
        items={[{ id: "a", title: "One", moreActions: <button type="button">Other</button> }]}
        testId="s"
      />,
    );
    expect(screen.queryByTestId("s-count")).toBeNull();
    expect(screen.getByTestId("record-step-a-more-actions-label").textContent).toBe("Or");
    expect(screen.getByTestId("record-step-a-more-actions")).toBeTruthy();
  });
});
