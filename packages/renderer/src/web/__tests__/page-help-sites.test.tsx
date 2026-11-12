// The page help sits in the projectionDetail header and in a relatedList section header; the
// relatedList one resolves the entity, labels and help sentences of another feature.

import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  ProjectionDetailScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { Dispatcher, EditRelatedListSectionViewModel } from "../../headless/index.ts";
import {
  AppFeaturesProvider,
  createStaticLocaleResolver,
  DispatcherProvider,
  type FeatureSchema,
  KumikoScreen,
  LocaleProvider,
  RelatedListSection,
} from "../../index.ts";
import { createMockDispatcher, render, screen, within } from "./test-utils.tsx";

const leaseEntity = {
  fields: {
    status: {
      type: "select",
      options: ["active", "terminated"],
      optionTones: { active: "ok", terminated: "bad" },
    },
  },
} as unknown as EntityDefinition;

const BUNDLE = {
  de: {
    "kumiko.pageHelp.button": "Status erklärt",
    "kumiko.pageHelp.title": "Status",
    "kumiko.dialog.close": "Schließen",
    "rentals:entity:lease:field:status:option:active": "Laufend",
    "rentals:entity:lease:field:status:option:active:help": "Der Vertrag läuft.",
    "rentals:entity:lease:field:status:option:terminated": "Gekündigt",
    "rentals:entity:lease:field:status:option:terminated:help": "Der Vertrag wurde beendet.",
  },
};

const rentals: FeatureSchema = {
  featureName: "rentals",
  entities: { lease: leaseEntity },
  screens: [],
};

function Locale({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "de" })}
      fallbackBundles={[BUNDLE]}
    >
      {children}
    </LocaleProvider>
  );
}

async function expectLegend(): Promise<void> {
  await userEvent.click(await screen.findByTestId("page-help-button"));
  const dialog = screen.getByTestId("page-help-dialog");
  const active = within(dialog).getByTestId("page-help-badge-active");
  expect(active.textContent).toContain("Laufend");
  expect(active.className).toContain("text-status-ok");
  expect(within(dialog).getByTestId("page-help-text-active").textContent).toBe(
    "Der Vertrag läuft.",
  );
  const terminated = within(dialog).getByTestId("page-help-badge-terminated");
  expect(terminated.textContent).toContain("Gekündigt");
  expect(terminated.className).toContain("text-status-bad");
  expect(within(dialog).getByTestId("page-help-text-terminated").textContent).toBe(
    "Der Vertrag wurde beendet.",
  );
}

describe("page help placement", () => {
  test("the projectionDetail header button opens the legend of the named entity", async () => {
    const detail: ProjectionDetailScreenDefinition = {
      id: "lease-detail",
      type: "projectionDetail",
      query: "rentals:query:lease:detail",
      idParam: "id",
      pageHelp: { entity: "lease", statusField: "status" },
      layout: { sections: [{ title: "Lease", fields: ["status"] }] },
    };
    const schema: FeatureSchema = { ...rentals, screens: [detail] };
    const query = (async () => ({
      isSuccess: true,
      data: { status: "active" },
    })) as unknown as Dispatcher["query"];
    render(
      <Locale>
        <DispatcherProvider dispatcher={createMockDispatcher({ query })}>
          <KumikoScreen schema={schema} qn="rentals:screen:lease-detail" entityId="l-1" />
        </DispatcherProvider>
      </Locale>,
    );
    await expectLegend();
  });

  test("a relatedList section header button shows labels and help of another feature's entity", async () => {
    const section: EditRelatedListSectionViewModel = {
      kind: "relatedList",
      title: "Verträge",
      query: "cases:query:lease:list",
      columns: ["status"],
      entity: "rentals:lease",
      pageHelp: { statusField: "status" },
    };
    const dispatcher = createMockDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { rows: [], nextCursor: null },
      })) as unknown as Dispatcher["query"],
    });
    render(
      <Locale>
        <DispatcherProvider dispatcher={dispatcher}>
          <AppFeaturesProvider features={[rentals]}>
            <RelatedListSection
              section={section}
              parentId="c1"
              record={{ id: "c1" }}
              featureName="cases"
            />
          </AppFeaturesProvider>
        </DispatcherProvider>
      </Locale>,
    );
    const header = await screen.findByTestId("related-list-Verträge");
    expect(within(header).getByTestId("page-help-button")).toBeTruthy();
    await expectLegend();
  });
});

describe("page help placement, more cases", () => {
  const section: EditRelatedListSectionViewModel = {
    kind: "relatedList",
    title: "Verträge",
    query: "cases:query:lease:list",
    columns: ["status"],
    entity: "rentals:lease",
    pageHelp: { statusField: "status" },
  };
  const emptyRows = createMockDispatcher({
    query: (async () => ({
      isSuccess: true,
      data: { rows: [], nextCursor: null },
    })) as unknown as Dispatcher["query"],
  });

  function mountSection(
    sectionSpec: EditRelatedListSectionViewModel,
    props: { readonly hideTitle?: boolean; readonly features?: readonly FeatureSchema[] },
  ): void {
    render(
      <Locale>
        <DispatcherProvider dispatcher={emptyRows}>
          <AppFeaturesProvider features={props.features ?? [rentals]}>
            <RelatedListSection
              section={sectionSpec}
              parentId="c1"
              record={{ id: "c1" }}
              featureName="cases"
              {...(props.hideTitle === true && { hideTitle: true })}
            />
          </AppFeaturesProvider>
        </DispatcherProvider>
      </Locale>,
    );
  }

  test("in tabs mode the button sits in the framed table toolbar and opens the legend", async () => {
    mountSection(section, { hideTitle: true });
    const button = await screen.findByTestId("page-help-button");
    expect(button.closest('[data-testid="related-list-card"]')).not.toBeNull();
    await expectLegend();
  });

  test("a pageHelp entity of the same feature that appFeatures does not know renders no button", async () => {
    const own: FeatureSchema = {
      featureName: "cases",
      entities: { lease: leaseEntity },
      screens: [],
    };
    mountSection(
      { ...section, entity: "lease", pageHelp: { statusField: "status", entity: "ghost" } },
      { features: [own] },
    );
    await screen.findByTestId("related-list-Verträge");
    expect(screen.queryByTestId("page-help-button")).toBeNull();
  });
});
