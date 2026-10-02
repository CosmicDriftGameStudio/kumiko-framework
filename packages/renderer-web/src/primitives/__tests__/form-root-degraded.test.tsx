// A <Form> nested inside another <Form> degrades to a <div> (FormRoot); it must
// still behave like a real <form> for Enter and for its own submit buttons only.
import { describe, expect, test } from "bun:test";
import {
  createStaticLocaleResolver,
  kumikoDefaultTranslations,
  LocaleProvider,
} from "@cosmicdrift/kumiko-renderer";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { BareFormProvider, defaultPrimitives } from "../index.js";

const { Form, Input, Button } = defaultPrimitives;
const noop = () => {};

function renderNested(counts: { outer: number; inner: number }, extra?: ReactNode) {
  return render(
    <LocaleProvider
      resolver={createStaticLocaleResolver()}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <Form
        testId="outer"
        onSubmit={() => {
          counts.outer += 1;
        }}
      >
        <Input kind="text" id="host" name="host" value="" onChange={noop} testId="host-field" />
        <BareFormProvider>
          <Form
            testId="inner"
            onSubmit={() => {
              counts.inner += 1;
            }}
            actions={
              <Button type="submit" testId="inner-submit">
                Save
              </Button>
            }
          >
            <Input kind="text" id="pw" name="pw" value="" onChange={noop} testId="inner-field" />
            {extra}
          </Form>
        </BareFormProvider>
      </Form>
    </LocaleProvider>,
  );
}

describe("degraded nested Form submit routing", () => {
  test("Enter in a field of the nested form submits it, not the outer form", () => {
    const counts = { outer: 0, inner: 0 };
    renderNested(counts);
    expect(screen.getByTestId("inner").tagName).toBe("DIV");
    fireEvent.keyDown(screen.getByTestId("inner-field"), { key: "Enter" });
    expect(counts).toEqual({ outer: 0, inner: 1 });
  });

  test("Enter in a host field does not submit the nested form", () => {
    const counts = { outer: 0, inner: 0 };
    renderNested(counts);
    fireEvent.keyDown(screen.getByTestId("host-field"), { key: "Enter" });
    expect(counts.inner).toBe(0);
  });

  test("a submit button rendered through a portal does not submit the nested form", () => {
    const counts = { outer: 0, inner: 0 };
    renderNested(counts, createPortal(<button type="submit">Portal</button>, document.body));
    fireEvent.click(screen.getByText("Portal"));
    expect(counts.inner).toBe(0);
  });

  test("its own submit button still submits the nested form", () => {
    const counts = { outer: 0, inner: 0 };
    renderNested(counts);
    fireEvent.click(screen.getByTestId("inner-submit"));
    expect(counts.inner).toBe(1);
  });
});
