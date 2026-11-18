import { describe, expect, test } from "bun:test";
import { screen } from "@testing-library/react";
import { ProgressList } from "../widgets/progress-list.tsx";
import { render } from "./test-utils.tsx";

describe("ProgressList", () => {
  test("each entry names itself above its bar, so a reader from the top pairs name and bar", () => {
    render(
      <ProgressList
        testId="loans"
        rows={[
          { id: "a", label: "Car loan", value: "4,000 €", fraction: 0.4 },
          { id: "b", label: "Mortgage", value: "90,000 €", fraction: 0.1 },
        ]}
      />,
    );

    const entries = screen.getByTestId("loans").querySelectorAll("li");
    for (const entry of Array.from(entries)) {
      const bar = entry.querySelector("[role=progressbar]");
      const label = Array.from(entry.querySelectorAll("span")).find((span) =>
        ["Car loan", "Mortgage"].includes(span.textContent ?? ""),
      );
      expect(bar).not.toBeNull();
      expect(label).toBeDefined();
      if (bar === null || label === undefined) return;
      expect(label.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });
});
