import { describe, expect, test } from "bun:test";
import { render } from "../../__tests__/test-utils.tsx";
import { defaultPrimitives } from "../index.tsx";

const { Form } = defaultPrimitives;

describe("chromeless tab form", () => {
  test("the header region (head card and tab strip) carries the gap to the tab content", () => {
    const { getByTestId } = render(
      <Form onSubmit={() => {}} chromeless headerRegion={<nav>Reiter</nav>} testId="f">
        <p>Inhalt</p>
      </Form>,
    );
    expect(getByTestId("f-header-region").className).toContain("pb-1.5");
  });

  test("without a header region no spacer renders", () => {
    const { queryByTestId } = render(
      <Form onSubmit={() => {}} chromeless testId="f">
        <p>Inhalt</p>
      </Form>,
    );
    expect(queryByTestId("f-header-region")).toBeNull();
  });
});
