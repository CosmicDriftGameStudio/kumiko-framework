import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { RenderEdit } from "@cosmicdrift/kumiko-renderer";
import { act } from "react";
import { fireEvent, render, screen } from "./test-utils.js";

const monitorEntity = {
  fields: {
    kind: { type: "select", options: ["http", "heartbeat"] },
    interval: {
      type: "select",
      options: ["60", "300", "3600"],
      conditionalOptions: [{ options: ["3600"], when: { field: "kind", eq: "heartbeat" } }],
    },
  },
} as unknown as EntityDefinition;

const monitorScreen: EntityEditScreenDefinition = {
  id: "monitoring:screen:monitor-edit",
  type: "entityEdit",
  entity: "monitor",
  layout: { sections: [{ fields: ["kind", "interval"] }] },
};

const noopSubmit = async (): Promise<{
  readonly isSuccess: true;
  readonly validationBlocked: false;
  readonly data: undefined;
}> => ({ isSuccess: true, validationBlocked: false, data: undefined });

describe("RenderEdit select conditionalOptions", () => {
  test("offers the heartbeat-only option only after switching the kind", async () => {
    render(
      <RenderEdit
        screen={monitorScreen}
        entity={monitorEntity}
        featureName="monitoring"
        initial={{ kind: "http", interval: "60" }}
        customSubmit={noopSubmit}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("combobox-kumiko-edit-interval"));
    });
    expect(await screen.findByTestId("combobox-kumiko-edit-interval-option-300")).toBeTruthy();
    expect(screen.queryByTestId("combobox-kumiko-edit-interval-option-3600")).toBeNull();

    await act(async () => {
      fireEvent.keyDown(screen.getByTestId("combobox-kumiko-edit-interval"), { key: "Escape" });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("segmented-kumiko-edit-kind-heartbeat"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("combobox-kumiko-edit-interval"));
    });

    expect(await screen.findByTestId("combobox-kumiko-edit-interval-option-3600")).toBeTruthy();
  });
});
