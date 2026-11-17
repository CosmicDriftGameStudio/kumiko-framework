import { describe, expect, test } from "bun:test";
import { screen, waitFor } from "@testing-library/react";
import { ListEmptyStateBody } from "../../components/list-empty-state.tsx";
import { DispatcherProvider } from "../../context/dispatcher-context.tsx";
import type { Translate } from "../../headless/index.ts";
import { type MockQueryHandler, makeDispatcher, render } from "../../web/__tests__/test-utils.tsx";
import { buildNamedFilterEmpty } from "../named-filter-facet.ts";

const translate: Translate = (key, params) =>
  params === undefined
    ? key
    : `${key}|${Object.entries(params)
        .map(([name, value]) => `${name}=${String(value)}`)
        .join(",")}`;

function bodyFor(emptyState: NonNullable<Parameters<typeof buildNamedFilterEmpty>[0]>[number]) {
  const content = buildNamedFilterEmpty(
    [{ ...emptyState }],
    emptyState.id,
    "",
    false,
    translate,
    () => {},
  );
  return (
    <ListEmptyStateBody
      content={undefined}
      narrowed
      namedFilterEmpty={content}
      createButton={null}
      translate={(key) => key}
    />
  );
}

describe("named filter empty state with a params query", () => {
  test("a static key keeps working and asks no query", () => {
    const asked: string[] = [];
    const query: MockQueryHandler = (type) => {
      asked.push(type);
      return { isSuccess: true, data: {} };
    };
    render(
      <DispatcherProvider dispatcher={makeDispatcher({ query })}>
        {bodyFor({
          id: "due",
          label: "Due",
          emptyState: { title: "empty.title", description: "empty.desc" },
        })}
      </DispatcherProvider>,
    );
    screen.getByText("empty.title");
    screen.getByText("empty.desc");
    expect(asked).toEqual([]);
  });

  test("the query result becomes the translation params", async () => {
    const asked: string[] = [];
    const query: MockQueryHandler = (type) => {
      asked.push(type);
      return { isSuccess: true, data: { name: "Meier", date: "08.11." } };
    };
    render(
      <DispatcherProvider dispatcher={makeDispatcher({ query })}>
        {bodyFor({
          id: "due",
          label: "Due",
          emptyState: {
            title: "empty.title",
            description: "empty.next",
            paramsQuery: "dunning:query:next",
          },
        })}
      </DispatcherProvider>,
    );
    await waitFor(() => screen.getByText("empty.next|name=Meier,date=08.11."));
    screen.getByText("empty.title");
    expect(asked[0]).toBe("dunning:query:next");
  });

  test("without data the description is not rendered, never a raw placeholder", () => {
    const query: MockQueryHandler = () => ({ isSuccess: true, data: null });
    render(
      <DispatcherProvider dispatcher={makeDispatcher({ query })}>
        {bodyFor({
          id: "due",
          label: "Due",
          emptyState: {
            title: "empty.title",
            description: "empty.next",
            paramsQuery: "dunning:query:next",
          },
        })}
      </DispatcherProvider>,
    );
    screen.getByText("empty.title");
    expect(screen.queryByText(/empty.next/)).toBeNull();
  });
});
