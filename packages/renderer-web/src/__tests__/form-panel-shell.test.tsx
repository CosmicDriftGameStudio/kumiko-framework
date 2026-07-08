// FormPanelShell — Panel-Geschwister von FormScreenShell für Visual-Panel-
// Editoren (Split-View neben einem Tree). Der Shell besitzt das <form>, damit
// der Sticky-Footer-Save den scrollenden Body submittet. Strukturelle
// Assertions (Klassen/DOM) plus der submit-Contract.

import { describe, expect, mock, test } from "bun:test";
import { FormPanelShell } from "../primitives";
import { fireEvent, render, screen } from "./test-utils";

describe("FormPanelShell", () => {
  test("Header: breadcrumb › title (subtitle); Body scrollt + max-w-2xl; Footer sticky border-t", () => {
    render(
      <FormPanelShell
        onSubmit={() => {}}
        testId="panel"
        breadcrumb="Content"
        title="Impressum"
        subtitle="(de)"
        actions={<button type="submit">Speichern</button>}
      >
        <div>body-field</div>
      </FormPanelShell>,
    );
    const form = screen.getByTestId("panel");
    // Der Shell IST das <form> und füllt die Panel-Höhe.
    expect(form.tagName).toBe("FORM");
    expect(form.className).toContain("h-full");
    // Header trägt breadcrumb + title + subtitle.
    const header = form.querySelector("header");
    expect(header?.textContent).toContain("Content");
    expect(header?.textContent).toContain("Impressum");
    expect(header?.textContent).toContain("(de)");
    // Body scrollt und ist auf eine lesbare Spalte begrenzt.
    expect(form.querySelector(".overflow-y-auto")).toBeTruthy();
    expect(form.querySelector(".max-w-2xl")).toBeTruthy();
    expect(screen.getByText("body-field")).toBeTruthy();
    // Footer ist border-t-abgesetzt und rechtsbündig.
    const footer = form.querySelector("footer");
    expect(footer?.className).toContain("border-t");
    expect(footer?.className).toContain("justify-end");
  });

  test("Footer-Submit submittet das Form (Body + Footer im selben <form>)", () => {
    const onSubmit = mock(() => {});
    render(
      <FormPanelShell
        onSubmit={onSubmit}
        testId="panel"
        title="T"
        actions={<button type="submit">Speichern</button>}
      >
        <input name="x" />
      </FormPanelShell>,
    );
    fireEvent.click(screen.getByText("Speichern"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  test("ohne actions kein Footer", () => {
    render(
      <FormPanelShell onSubmit={() => {}} testId="p2" title="T">
        <div>b</div>
      </FormPanelShell>,
    );
    expect(screen.getByTestId("p2").querySelector("footer")).toBeNull();
  });
});
