import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { DispatcherProvider, ExtensionSectionsProvider, RenderEdit } from "../../index.ts";
import { makeDispatcher, orderEntity, type TestValues } from "./_render-edit-helpers.tsx";
import { fireEvent, render, screen } from "./test-utils.tsx";

function SidebarEcho({
  values,
}: {
  readonly values?: Readonly<Record<string, unknown>>;
}): ReactNode {
  return <aside data-testid="sidebar-echo">{String(values?.["title"])}</aside>;
}

describe("RenderEdit — slots.sidebar", () => {
  test("sidebar mounts under the sections and follows the live form values", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <ExtensionSectionsProvider value={{ SidebarEcho }}>
          <RenderEdit<TestValues>
            screen={{
              id: "orders:screen:order-edit-sidebar",
              type: "entityEdit",
              entity: "order",
              layout: {
                sections: [{ title: "Basics", columns: 1, fields: [{ field: "title" }] }],
              },
              slots: { sidebar: { react: { __component: "SidebarEcho" } } },
            }}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "Acme", count: 0, isUrgent: false }}
            writeCommand="order:update"
            entityId="order-1"
          />
        </ExtensionSectionsProvider>
      </DispatcherProvider>,
    );

    expect(screen.getByTestId("sidebar-echo").textContent).toBe("Acme");
    const input = screen.getByTestId("field-title").querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Globex" } });
    expect(screen.getByTestId("sidebar-echo").textContent).toBe("Globex");
  });
});
