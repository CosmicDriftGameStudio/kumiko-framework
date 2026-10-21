import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "../../headless/index.ts";
import { defaultPrimitives } from "../primitives/index.tsx";
import { createMockDispatcher } from "./test-utils.tsx";

export const orderEntity = {
  fields: {
    title: { type: "text", required: true },
    count: { type: "number" },
    isUrgent: { type: "boolean" },
    notes: { type: "text" },
  },
} as unknown as EntityDefinition;

export const { Button } = defaultPrimitives;

export function makeScreen(): EntityEditScreenDefinition {
  return {
    id: "orders:screen:order-edit",
    type: "entityEdit",
    entity: "order",
    layout: {
      sections: [
        {
          title: "Basics",
          columns: 2,
          fields: [
            { field: "title", span: 2 },
            "count",
            "isUrgent",
            {
              field: "notes",
              visible: { field: "isUrgent", eq: true },
              required: { field: "isUrgent", eq: true },
            },
          ],
        },
      ],
    },
  };
}

export function makeDispatcher(writeFn?: Dispatcher["write"]): Dispatcher {
  return createMockDispatcher({
    write:
      writeFn ?? ((async () => ({ isSuccess: true, data: { id: "1" } })) as Dispatcher["write"]),
  });
}

export type TestValues = {
  title: string;
  count?: number;
  isUrgent?: boolean;
  notes?: string;
  slug?: string;
};
