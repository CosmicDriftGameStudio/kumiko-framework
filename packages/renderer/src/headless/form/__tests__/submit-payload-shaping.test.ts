import { describe, expect, mock, test } from "bun:test";
import { createMockDispatcher, type MockWriteHandler } from "../../../testing.ts";
import { createFormController } from "../form-controller.ts";

function makeDispatcher() {
  const writeSpy = mock<MockWriteHandler>(async () => ({ isSuccess: true, data: { id: "srv-1" } }));
  const dispatcher = createMockDispatcher({
    write: writeSpy,
    query: async () => ({ isSuccess: true, data: null }),
    batch: async () => ({ isSuccess: true, results: [] }),
  });
  return { dispatcher, writeSpy };
}

type Shaped = { readonly wrapped: unknown };

describe("createFormController: omitFields with buildPayload", () => {
  const wrapAsChanges = (_snapshot: unknown, shapedValues: unknown): Shaped => ({
    wrapped: shapedValues,
  });

  test("with a prefix, omit only trims the shaped values and wrapper keys of the same name survive", async () => {
    const { dispatcher, writeSpy } = makeDispatcher();
    const form = createFormController({
      initial: { title: "hello", note: "display only" },
      submit: {
        dispatcher,
        type: "app:write:task:update",
        omitFields: ["note"],
        serverFieldPathPrefix: "changes.",
        buildPayload: (_snapshot, shapedValues) => ({
          note: "keep",
          changes: shapedValues,
        }),
      },
    });

    await form.submit();

    expect(writeSpy.mock.calls[0]?.[1]).toEqual({ note: "keep", changes: { title: "hello" } });
  });

  test("without a prefix, the omit also applies to the built payload's top level", async () => {
    const { dispatcher, writeSpy } = makeDispatcher();
    const form = createFormController({
      initial: { title: "hello", note: "display only" },
      submit: {
        dispatcher,
        type: "app:write:task:update",
        omitFields: ["note"],
        buildPayload: (_snapshot, shapedValues) => ({ note: "wrapper", values: shapedValues }),
      },
    });

    await form.submit();

    expect(writeSpy.mock.calls[0]?.[1]).toEqual({ values: { title: "hello" } });
  });

  test("shaped values drop untouched empty seeds, unless stripEmptySeeds is false", async () => {
    const stripped = makeDispatcher();
    const strippingForm = createFormController({
      initial: { title: "hello", dueDate: "" },
      submit: {
        dispatcher: stripped.dispatcher,
        type: "app:write:task:update",
        buildPayload: wrapAsChanges,
      },
    });
    await strippingForm.submit();
    expect(stripped.writeSpy.mock.calls[0]?.[1]).toEqual({ wrapped: { title: "hello" } });

    const kept = makeDispatcher();
    const keepingForm = createFormController({
      initial: { title: "hello", dueDate: "" },
      submit: {
        dispatcher: kept.dispatcher,
        type: "app:write:task:update",
        stripEmptySeeds: false,
        buildPayload: wrapAsChanges,
      },
    });
    await keepingForm.submit();
    expect(kept.writeSpy.mock.calls[0]?.[1]).toEqual({
      wrapped: { title: "hello", dueDate: "" },
    });
  });
});
