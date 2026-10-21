import { expect } from "bun:test";
import {
  type EntityEditScreenDefinition,
  type EntityListScreenDefinition,
  translationValueOtherText,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { FeatureSchema } from "../../index.ts";
import { kumikoDefaultTranslations } from "../../index.ts";
import { act, fireEvent, screen, taskEntity, waitFor } from "./test-utils.tsx";

export function defaultEnText(key: string): string {
  const value = kumikoDefaultTranslations["en"]?.[key];
  return value === undefined ? "" : translationValueOtherText(value);
}

export const editScreen: EntityEditScreenDefinition = {
  id: "task-edit",
  type: "entityEdit",
  entity: "task",
  layout: {
    sections: [{ title: "Basics", fields: ["title", "count", "done"] }],
  },
};

export const listScreen: EntityListScreenDefinition = {
  id: "task-list",
  type: "entityList",
  entity: "task",
  columns: ["title", "count", "done"],
};

const restrictedListScreen: EntityListScreenDefinition = {
  id: "task-list-restricted",
  type: "entityList",
  entity: "task",
  columns: ["title"],
  access: { roles: ["Admin"] },
};

export const schema: FeatureSchema = {
  featureName: "tasks",
  entities: { task: taskEntity },
  screens: [editScreen, listScreen, restrictedListScreen],
};

// Re-queries the button (a held reference may have been detached by a
// re-render) and waits for it to actually be clickable before firing the
// click — a disabled native button swallows fireEvent.click silently.
export async function clickSubmitOnceEnabled(
  scope: () => Pick<typeof screen, "getByTestId"> = () => screen,
): Promise<void> {
  await waitFor(() => {
    const button = scope().getByTestId("render-edit-submit");
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("render-edit-submit is not a <button>");
    }
    expect(button.disabled).toBe(false);
  });
  await act(async () => {
    fireEvent.click(scope().getByTestId("render-edit-submit"));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}
