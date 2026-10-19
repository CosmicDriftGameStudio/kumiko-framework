import { describe, expect, mock, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { DispatcherProvider, RenderEdit } from "@cosmicdrift/kumiko-renderer";
import type { Dispatcher } from "@cosmicdrift/kumiko-renderer/headless";
import userEvent from "@testing-library/user-event";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.tsx";

const siteEntity = {
  fields: {
    baseDomain: { type: "text" },
    slug: { type: "text" },
    seats: { type: "number" },
    weight: { type: "number" },
  },
} as unknown as EntityDefinition;

const SCREEN: EntityEditScreenDefinition = {
  id: "demo:screen:site-edit",
  type: "entityEdit",
  entity: "site",
  layout: {
    sections: [
      {
        title: "Site",
        fields: [
          { field: "baseDomain", visible: false },
          {
            field: "slug",
            readOnly: true,
            prefix: "https://",
            suffix: { field: "baseDomain" },
            fillAction: {
              label: "Roll a name",
              query: "demo:query:suggest-slug",
              field: "suggestion",
              params: { pick: ["seats"] },
            },
          },
          { field: "seats", suffix: "seats" },
          {
            field: "weight",
            fillAction: {
              label: "Suggest weight",
              query: "demo:query:suggest-weight",
              field: "kg",
            },
          },
        ],
      },
    ],
  },
};

type QueryFn = Dispatcher["query"];
type QueryResult = { isSuccess: true; data: unknown } | { isSuccess: false };

function queryReturning(result: QueryResult) {
  const calls: Array<readonly [string, unknown]> = [];
  const query = (async (type: string, payload: unknown) => {
    calls.push([type, payload]);
    return result.isSuccess
      ? result
      : { isSuccess: false, error: { code: "handler_failed", message: "boom", details: {} } };
  }) as unknown as QueryFn;
  return Object.assign(query, { calls });
}

function renderSite(options: {
  query: QueryFn;
  write?: Dispatcher["write"];
  onDirtyChange?: (dirty: boolean) => void;
  disabled?: boolean;
}) {
  const dispatcher = createMockDispatcher({
    query: options.query,
    ...(options.write !== undefined && { write: options.write }),
  });
  return render(
    <DispatcherProvider dispatcher={dispatcher}>
      <RenderEdit
        screen={SCREEN}
        entity={siteEntity}
        featureName="demo"
        initial={{ baseDomain: "example.org", slug: "", seats: 3 }}
        writeCommand="site:create"
        {...(options.onDirtyChange !== undefined && { onDirtyChange: options.onDirtyChange })}
        {...(options.disabled === true && { disabled: true })}
      />
    </DispatcherProvider>,
  );
}

function slugInput(): HTMLInputElement {
  const input = screen.getByTestId("field-slug").querySelector("input");
  if (!input) throw new Error("expected the slug input");
  return input;
}

describe("field prefix, suffix and fillAction", () => {
  test("renders a string prefix, a suffix read from another field and a string suffix", () => {
    renderSite({ query: queryReturning({ isSuccess: true, data: {} }) });

    expect(screen.getByTestId("input-prefix-slug").textContent).toBe("https://");
    expect(screen.getByTestId("input-suffix-slug").textContent).toBe("example.org");
    expect(screen.getByTestId("input-suffix-seats").textContent).toBe("seats");
    expect(screen.queryByTestId("input-prefix-seats")).toBeNull();
  });

  test("a suffix from another field renders nothing while that field is empty", () => {
    const dispatcher = createMockDispatcher();
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <RenderEdit
          screen={SCREEN}
          entity={siteEntity}
          featureName="demo"
          initial={{ baseDomain: "", slug: "" }}
          writeCommand="site:create"
        />
      </DispatcherProvider>,
    );

    expect(screen.queryByTestId("input-suffix-slug")).toBeNull();
  });

  test("the fill button runs the query with the picked form values and fills a readOnly field", async () => {
    const query = queryReturning({ isSuccess: true, data: { suggestion: "quiet-fox" } });
    const onDirtyChange = mock((_dirty: boolean) => {});
    renderSite({ query, onDirtyChange });
    expect(slugInput().disabled).toBe(true);
    expect(onDirtyChange).not.toHaveBeenCalledWith(true);

    await userEvent.setup().click(screen.getByTestId("field-fill-slug"));

    await waitFor(() => expect(slugInput().value).toBe("quiet-fox"));
    expect(query.calls[0]?.[0]).toBe("demo:query:suggest-slug");
    expect(query.calls[0]?.[1]).toEqual({ seats: 3 });
    await waitFor(() => expect(onDirtyChange).toHaveBeenCalledWith(true));
  });

  test("a value filled into a readOnly field is part of the submitted payload", async () => {
    const payloads: unknown[] = [];
    const write = (async (_type: string, payload: unknown) => {
      payloads.push(payload);
      return { isSuccess: true, data: { id: "1" } };
    }) as unknown as Dispatcher["write"];
    renderSite({
      query: queryReturning({ isSuccess: true, data: { suggestion: "quiet-fox" } }),
      write,
    });
    const user = userEvent.setup();

    await user.click(screen.getByTestId("field-fill-slug"));
    await waitFor(() => expect(slugInput().value).toBe("quiet-fox"));
    await user.click(screen.getByTestId("render-edit-submit"));

    await waitFor(() => expect(payloads).toHaveLength(1));
    expect(payloads[0]).toMatchObject({ slug: "quiet-fox" });
  });

  test("a failed query shows an error and leaves the value alone", async () => {
    renderSite({ query: queryReturning({ isSuccess: false }) });

    await userEvent.setup().click(screen.getByTestId("field-fill-slug"));

    await waitFor(() => expect(screen.getByTestId("field-fill-error-slug")).toBeTruthy());
    expect(slugInput().value).toBe("");
  });

  test("a result that is not a string or number counts as a failed fill", async () => {
    renderSite({ query: queryReturning({ isSuccess: true, data: { suggestion: { a: 1 } } }) });

    await userEvent.setup().click(screen.getByTestId("field-fill-slug"));

    await waitFor(() => expect(screen.getByTestId("field-fill-error-slug")).toBeTruthy());
    expect(slugInput().value).toBe("");
  });

  test("a numeric field accepts only a number from the query", async () => {
    const query = queryReturning({ isSuccess: true, data: { kg: "heavy" } });
    renderSite({ query });

    await userEvent.setup().click(screen.getByTestId("field-fill-weight"));

    await waitFor(() => expect(screen.getByTestId("field-fill-error-weight")).toBeTruthy());
  });

  test("the button is inert while the query runs and a later success clears the error", async () => {
    let resolveQuery: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      resolveQuery = resolve;
    });
    const query = (async () => pending) as unknown as QueryFn;
    renderSite({ query });
    const user = userEvent.setup();

    await user.click(screen.getByTestId("field-fill-slug"));
    await waitFor(() =>
      expect((screen.getByTestId("field-fill-slug") as HTMLButtonElement).disabled).toBe(true),
    );
    resolveQuery({ isSuccess: true, data: { suggestion: "calm-owl" } });

    await waitFor(() => expect(slugInput().value).toBe("calm-owl"));
    expect((screen.getByTestId("field-fill-slug") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByTestId("field-fill-error-slug")).toBeNull();
  });

  test("a locked form keeps the fill button visible but disabled", () => {
    renderSite({ query: queryReturning({ isSuccess: true, data: {} }), disabled: true });

    expect((screen.getByTestId("field-fill-slug") as HTMLButtonElement).disabled).toBe(true);
  });
});
