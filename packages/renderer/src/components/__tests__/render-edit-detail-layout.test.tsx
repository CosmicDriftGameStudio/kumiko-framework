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
import { type CorePrimitives, type FormProps, PrimitivesProvider } from "../../primitives.tsx";
import { RenderEdit } from "../render-edit.tsx";

const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

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

function renderFormProps(screen: EntityEditScreenDefinition): FormProps[] {
  const formProps: FormProps[] = [];
  const primitives: CorePrimitives = {
    Button: noop,
    Banner: noop,
    Field: passChildren,
    Input: noop,
    DataTable: noop,
    Form: (props: FormProps) => {
      formProps.push(props);
      return props.children;
    },
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
    PageHeader: noop,
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
            entityId="w1"
            initial={{ name: "Release 1.2" }}
            fillScreenHeight
            headerRegion={<span>header</span>}
          />
        </PrimitivesProvider>
      </PageHeaderSlotAvailableProvider>
    </LocaleProvider>,
  );
  return formProps;
}

describe("RenderEdit — title block next to a headerRegion", () => {
  test("with recordTitleField + headerRegion the form title block is dropped", () => {
    expect(renderFormProps(screenWith("name"))[0]?.title).toBeUndefined();
  });

  test("without recordTitleField the shell header shows the screen title, so the form title is dropped too", () => {
    expect(renderFormProps(screenWith(undefined))[0]?.title).toBeUndefined();
  });
});
