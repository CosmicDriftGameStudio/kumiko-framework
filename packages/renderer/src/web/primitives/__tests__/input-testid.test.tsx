// Input forwards testId (as data-testid) and readOnly to the real <input> so
// app tests can use getByTestId(...) and assert .readOnly/.disabled.
import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { defaultPrimitives } from "../index.tsx";

const { Input } = defaultPrimitives;
const noop = () => {};

describe("DefaultInput testId/readOnly forwarding (#950)", () => {
  test("text: testId → data-testid, readOnly durchgereicht", () => {
    render(
      <Input
        kind="text"
        id="subdomain"
        name="subdomain"
        value="acme"
        onChange={noop}
        testId="url-settings-subdomain"
        readOnly
      />,
    );
    const input = screen.getByTestId("url-settings-subdomain");
    expect(input.tagName).toBe("INPUT");
    expect((input as HTMLInputElement).readOnly).toBe(true);
  });

  test("readOnly default false (nicht gesetzt = editierbar)", () => {
    render(<Input kind="text" id="x" name="x" value="" onChange={noop} testId="plain" />);
    expect((screen.getByTestId("plain") as HTMLInputElement).readOnly).toBe(false);
  });

  test("email/password/number: testId erreicht das Element", () => {
    render(
      <>
        <Input kind="email" id="e" name="e" value="" onChange={noop} testId="tid-email" />
        <Input kind="password" id="p" name="p" value="" onChange={noop} testId="tid-pw" />
        <Input kind="number" id="n" name="n" value={1} onChange={noop} testId="tid-num" />
      </>,
    );
    for (const tid of ["tid-email", "tid-pw", "tid-num"]) {
      expect(screen.getByTestId(tid).tagName).toBe("INPUT");
    }
  });
});
