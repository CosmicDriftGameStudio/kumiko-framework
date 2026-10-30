import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.tsx";
import { kumikoDefaultTranslations } from "../../i18n-defaults.ts";
import { PageHeaderSlotAvailableProvider } from "../../page-header-slot.ts";
import {
  type CorePrimitives,
  type FormProps,
  type PageHeaderProps,
  PrimitivesProvider,
} from "../../primitives.tsx";
import { RenderEdit } from "../render-edit.tsx";

const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const passFormChildren = (props: FormProps): ReactNode => props.children;

const entity: EntityDefinition = {
  fields: {
    name: {
      type: "text",
      allowPlaintext: "test fixture value, not personal data",
      maxLength: 200,
      required: false,
      searchable: false,
      sortable: false,
    },
  },
};

function screenWith(recordTitleField: string | undefined): EntityEditScreenDefinition {
  return {
    id: "widget-edit",
    type: "entityEdit",
    entity: "widget",
    ...(recordTitleField !== undefined && { recordTitleField }),
    layout: { sections: [{ title: "Basics", fields: ["name"] }] },
  };
}

function renderCapturingPageHeader(
  screen: EntityEditScreenDefinition,
  options: { readonly entityId: string | null; readonly name: string },
): PageHeaderProps | undefined {
  let captured: PageHeaderProps | undefined;
  const primitives: CorePrimitives = {
    Button: noop,
    Banner: noop,
    Field: passChildren,
    Input: noop,
    DataTable: noop,
    Form: passFormChildren,
    Section: passChildren,
    Card: passChildren,
    Grid: passChildren,
    GridCell: passChildren,
    Text: passChildren,
    Heading: noop,
    Dialog: noop,
    Modal: noop,
    Lightbox: noop,
    ConfigSourceBadge: noop,
    ConfigCascadeView: noop,
    Link: noop,
    // biome-ignore lint/correctness/noComponentHookFactories: closes over the renderCapturingPageHeader-local captured variable; defined once per renderCapturingPageHeader call, never during a render
    PageHeader: (props: PageHeaderProps) => {
      captured = props;
      return null;
    },
  };
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en-US" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <PageHeaderSlotAvailableProvider value={true}>
        <PrimitivesProvider value={primitives}>
          <RenderEdit
            screen={screen}
            entity={entity}
            featureName="widgets"
            entityId={options.entityId}
            initial={{ name: options.name }}
          />
        </PrimitivesProvider>
      </PageHeaderSlotAvailableProvider>
    </LocaleProvider>,
  );
  return captured;
}

describe("RenderEdit — recordTitleField feeds the page header", () => {
  test("edit mode passes the loaded record's value as recordTitle", () => {
    const header = renderCapturingPageHeader(screenWith("name"), {
      entityId: "w1",
      name: "Škoda Octavia 2021",
    });
    expect(header?.recordTitle).toBe("Škoda Octavia 2021");
  });

  test("create mode passes no recordTitle", () => {
    const header = renderCapturingPageHeader(screenWith("name"), {
      entityId: null,
      name: "Škoda Octavia 2021",
    });
    expect(header).toBeDefined();
    expect(header && "recordTitle" in header).toBe(false);
  });

  test("an empty value passes no recordTitle", () => {
    const header = renderCapturingPageHeader(screenWith("name"), { entityId: "w1", name: "  " });
    expect(header).toBeDefined();
    expect(header && "recordTitle" in header).toBe(false);
  });

  test("a screen without recordTitleField passes no recordTitle", () => {
    const header = renderCapturingPageHeader(screenWith(undefined), {
      entityId: "w1",
      name: "Škoda",
    });
    expect(header).toBeDefined();
    expect(header && "recordTitle" in header).toBe(false);
  });
});
