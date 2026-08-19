import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { RenderEdit } from "@cosmicdrift/kumiko-renderer";
import { render, screen } from "./test-utils";

// fw#2245 Teil 2: `RenderEditProps.valueDisplay` — "text" renders a
// field.readOnly field as formatted plain text instead of a disabled Input.
// Confined by construction: the prop defaults to "form" (old behavior)
// at this generic component, ProjectionDetailBody is the only caller that
// passes "text" by default (kumiko-screen.tsx) — every other RenderEdit
// caller in the ecosystem keeps the disabled-Input look unless it opts in.

const accountEntity = {
  fields: {
    name: { type: "text" },
    active: { type: "boolean" },
    balance: { type: "money" },
  },
} as unknown as EntityDefinition;

function makeScreen(): EntityEditScreenDefinition {
  return {
    id: "accounts:screen:account-detail",
    type: "entityEdit",
    entity: "account",
    layout: {
      sections: [
        {
          fields: [
            "name",
            { field: "active", readOnly: true },
            { field: "balance", readOnly: true },
          ],
        },
      ],
    },
  };
}

const noopSubmit = async (): Promise<{
  readonly isSuccess: true;
  readonly validationBlocked: false;
  readonly data: undefined;
}> => ({ isSuccess: true, validationBlocked: false, data: undefined });

describe("RenderEdit valueDisplay (fw#2245)", () => {
  test('default ("form") keeps readOnly fields as disabled Inputs — unaffected callers stay unchanged', () => {
    render(
      <RenderEdit
        screen={makeScreen()}
        entity={accountEntity}
        featureName="accounts"
        initial={{ name: "Ada", active: true, balance: { amount: 12.5 } }}
        customSubmit={noopSubmit}
      />,
    );

    const activeInput = screen.getByTestId("field-active").querySelector("input");
    expect(activeInput).not.toBeNull();
    expect(activeInput?.disabled).toBe(true);
  });

  test('"text" renders readOnly fields as formatted plain text, no Input in the DOM', () => {
    render(
      <RenderEdit
        screen={makeScreen()}
        entity={accountEntity}
        featureName="accounts"
        initial={{ name: "Ada", active: true, balance: { amount: 12.5 } }}
        customSubmit={noopSubmit}
        valueDisplay="text"
      />,
    );

    expect(screen.getByTestId("field-active").querySelector("input")).toBeNull();
    expect(screen.getByTestId("field-value-active").textContent).toBe("✓");

    expect(screen.getByTestId("field-balance").querySelector("input")).toBeNull();
    expect(screen.getByTestId("field-value-balance").textContent).toContain("12.50");
  });

  test('"text" still leaves editable (non-readOnly) fields as live Inputs', () => {
    render(
      <RenderEdit
        screen={makeScreen()}
        entity={accountEntity}
        featureName="accounts"
        initial={{ name: "Ada", active: true, balance: { amount: 12.5 } }}
        customSubmit={noopSubmit}
        valueDisplay="text"
      />,
    );

    const nameInput = screen.getByTestId("field-name").querySelector("input");
    expect(nameInput).not.toBeNull();
    expect(nameInput?.value).toBe("Ada");
  });
});
