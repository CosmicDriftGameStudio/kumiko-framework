// @vitest-environment jsdom
//
// Default-Primitives für Web-Renderer. Tests pinnen den Vertrag, den die
// Renderer-Komponenten (RenderEdit, RenderList, KumikoScreen) an die
// Primitives weiterreichen — vor allem Accessibility-Zusagen
// (role="alert" bei Error-Varianten), Event-Shape-Mapping (Input
// liefert pro kind unterschiedliche JS-Typen zurück statt des rohen
// ChangeEvent) und das testId-Forwarding, von dem die E2E-Tests
// abhängen werden.

import { describe, expect, test, vi } from "vitest";
import { defaultPrimitives } from "../primitives";
import { fireEvent, render, screen } from "./test-utils";

const { Button, Banner, Field, Input, DataTable, Form, Text } = defaultPrimitives;

describe("Button", () => {
  test("disabled: attribute gesetzt + Tailwind-Klassen für pointer-events/opacity", () => {
    render(
      <Button disabled testId="btn">
        Save
      </Button>,
    );
    const btn = screen.getByTestId("btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    // Visuelles Feedback kommt aus Tailwind-Klassen (shadcn-Pattern).
    expect(btn.className).toContain("disabled:pointer-events-none");
    expect(btn.className).toContain("disabled:opacity-50");
  });

  test("onClick fires on click", () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} testId="btn">
        Go
      </Button>,
    );
    fireEvent.click(screen.getByTestId("btn"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("Banner", () => {
  test('variant="error" sets role="alert" (a11y)', () => {
    render(
      <Banner variant="error" testId="b">
        Something broke
      </Banner>,
    );
    expect(screen.getByTestId("b").getAttribute("role")).toBe("alert");
  });

  test('variant="info" has no alert role', () => {
    render(
      <Banner variant="info" testId="b">
        Hi
      </Banner>,
    );
    expect(screen.getByTestId("b").getAttribute("role")).toBeNull();
  });

  test("actions prop renders in actions slot", () => {
    render(
      <Banner variant="info" testId="b" actions={<span>undo</span>}>
        Saved
      </Banner>,
    );
    const slot = screen.getByTestId("b").querySelector('[data-slot="actions"]');
    expect(slot?.textContent).toBe("undo");
  });
});

describe("Field", () => {
  test("required fügt einen Stern ans Label an", () => {
    render(
      <Field id="f1" label="Name" required testId="f">
        <input />
      </Field>,
    );
    // shadcn-Field rendert den Mark als <span>* mit text-destructive.
    const label = screen.getByTestId("f").querySelector("label");
    expect(label?.textContent).toContain("*");
  });

  test("issues render inside role=alert with per-testId suffix", () => {
    render(
      <Field
        id="f1"
        label="Email"
        testId="f"
        issues={[{ path: "email", code: "invalid", i18nKey: "Email invalid" }]}
      >
        <input />
      </Field>,
    );
    const alert = screen.getByTestId("f-errors");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain("Email invalid");
  });

  test("no issues → no alert element", () => {
    render(
      <Field id="f1" label="Email" testId="f">
        <input />
      </Field>,
    );
    expect(screen.queryByTestId("f-errors")).toBeNull();
  });
});

describe("Input kind mapping", () => {
  test('kind="text": onChange receives string', () => {
    const onChange = vi.fn();
    render(<Input id="i" name="i" kind="text" value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hello" } });
    expect(onChange).toHaveBeenCalledWith("hello");
  });

  test('kind="number": "" → undefined, numeric → number', () => {
    const onChange = vi.fn();
    render(<Input id="i" name="i" kind="number" value={0} onChange={onChange} />);
    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "42" } });
    expect(onChange).toHaveBeenLastCalledWith(42);
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  test('kind="boolean": onChange receives checked', () => {
    const onChange = vi.fn();
    render(<Input id="i" name="i" kind="boolean" value={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  test('kind="date": "" → undefined', () => {
    const onChange = vi.fn();
    render(<Input id="i" name="i" kind="date" value="2026-04-23" onChange={onChange} />);
    const input = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  test("hasError=true sets aria-invalid", () => {
    render(<Input id="i" name="i" kind="text" value="" hasError onChange={() => {}} />);
    expect(screen.getByRole("textbox").getAttribute("aria-invalid")).toBe("true");
  });
});

describe("DataTable", () => {
  test("empty rows render empty-state slot with derived testId", () => {
    render(
      <DataTable
        columns={[{ field: "name", label: "Name", type: "string", sortable: false }]}
        rows={[]}
        testId="t"
      />,
    );
    // getByTestId throws if missing — existence assertion is implicit.
    expect(screen.getByTestId("t-empty")).not.toBeNull();
  });

  test("rows + cells get individual testIds for E2E hooks", () => {
    render(
      <DataTable
        columns={[
          { field: "name", label: "Name", type: "string", sortable: false },
          { field: "active", label: "Active", type: "boolean", sortable: false },
        ]}
        rows={[{ id: "r1", values: { name: "Alice", active: true } }]}
        testId="t"
      />,
    );
    expect(screen.getByTestId("row-r1")).not.toBeNull();
    expect(screen.getByTestId("cell-r1-name").textContent).toBe("Alice");
    expect(screen.getByTestId("cell-r1-active").textContent).toBe("✓");
  });

  test("onRowClick fires with the clicked row", () => {
    const onRowClick = vi.fn();
    const row = { id: "r1", values: { name: "Alice" } };
    render(
      <DataTable
        columns={[{ field: "name", label: "Name", type: "string", sortable: false }]}
        rows={[row]}
        onRowClick={onRowClick}
      />,
    );
    fireEvent.click(screen.getByTestId("row-r1"));
    expect(onRowClick).toHaveBeenCalledWith(row);
  });
});

describe("Form", () => {
  test("submit calls onSubmit and prevents default navigation", () => {
    const onSubmit = vi.fn();
    render(
      <Form onSubmit={onSubmit} testId="form">
        <button type="submit">Go</button>
      </Form>,
    );
    const form = screen.getByTestId("form") as HTMLFormElement;
    const submitEvent = new Event("submit", { bubbles: true, cancelable: true });
    fireEvent(form, submitEvent);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(submitEvent.defaultPrevented).toBe(true);
  });
});

describe("Text variants", () => {
  test('variant="code" renders <code>', () => {
    render(
      <Text variant="code" testId="t">
        x
      </Text>,
    );
    expect(screen.getByTestId("t").tagName).toBe("CODE");
  });

  test('variant="small" renders <small>', () => {
    render(
      <Text variant="small" testId="t">
        x
      </Text>,
    );
    expect(screen.getByTestId("t").tagName).toBe("SMALL");
  });

  test('variant="required-mark" renders data-required span', () => {
    render(
      <Text variant="required-mark" testId="t">
        *
      </Text>,
    );
    const el = screen.getByTestId("t");
    expect(el.tagName).toBe("SPAN");
    expect(el.hasAttribute("data-required")).toBe(true);
  });
});
