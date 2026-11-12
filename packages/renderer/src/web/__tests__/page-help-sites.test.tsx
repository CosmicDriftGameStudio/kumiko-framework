// The page help is one question-mark button per page: the projectionDetail owns it and collects the
// sections of its relatedList sections, which render no button of their own.

import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  ProjectionDetailScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { Dispatcher } from "../../headless/index.ts";
import {
  AppFeaturesProvider,
  createStaticLocaleResolver,
  DispatcherProvider,
  type FeatureSchema,
  KumikoScreen,
  LocaleProvider,
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

const claimEntity = {
  fields: { status: { type: "select", options: ["open", "closed"] } },
} as unknown as EntityDefinition;

const BUNDLE = {
  de: {
    "kumiko.pageHelp.button": "Hilfe zu dieser Seite",
    "kumiko.pageHelp.buttonLabel": "Erklärungen",
    "kumiko.pageHelp.statusIntro": "Was die Status bedeuten",
    "kumiko.dialog.close": "Schließen",
    "rentals:entity:lease:noun": "Mietvertrag",
    "rentals:entity:lease:field:status": "Status",
    "rentals:entity:lease:field:status:option:active": "Laufend",
    "rentals:entity:lease:field:status:option:active:help": "Der Vertrag läuft.",
    "rentals:entity:lease:field:status:option:terminated": "Gekündigt",
    "rentals:entity:lease:field:status:option:terminated:help": "Der Vertrag wurde beendet.",
    "screen:case-detail.title": "Fall",
    "cases:entity:claim:noun": "Vorgang",
    "cases:entity:claim:field:status": "Status",
    "cases:entity:claim:field:status:option:open": "Offen",
    "cases:entity:claim:field:status:option:open:help": "Der Vorgang wartet.",
    "cases:entity:claim:field:status:option:closed": "Erledigt",
    "cases:entity:claim:field:status:option:closed:help": "Der Vorgang ist fertig.",
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

const detailAndRows = createMockDispatcher({
  query: (async () => ({
    isSuccess: true,
    data: { status: "active", rows: [], nextCursor: null },
  })) as unknown as Dispatcher["query"],
});

describe("page help placement", () => {
  test("the projectionDetail button opens the legend of the named entity", async () => {
    const detail: ProjectionDetailScreenDefinition = {
      id: "lease-detail",
      type: "projectionDetail",
      query: "rentals:query:lease:detail",
      idParam: "id",
      pageHelp: { sections: [{ kind: "status", field: "status", entity: "lease" }] },
      layout: { sections: [{ title: "Lease", fields: ["status"] }] },
    };
    const schema: FeatureSchema = { ...rentals, screens: [detail] };
    render(
      <Locale>
        <DispatcherProvider dispatcher={detailAndRows}>
          <KumikoScreen schema={schema} qn="rentals:screen:lease-detail" entityId="l-1" />
        </DispatcherProvider>
      </Locale>,
    );
    await userEvent.click(await screen.findByTestId("page-help-button"));
    const drawer = screen.getByTestId("page-help-drawer");
    const active = within(drawer).getByTestId("page-help-badge-active");
    expect(active.textContent).toContain("Laufend");
    expect(active.className).toContain("text-status-ok");
    expect(within(drawer).getByTestId("page-help-text-active").textContent).toBe(
      "Der Vertrag läuft.",
    );
    expect(within(drawer).getByTestId("page-help-badge-terminated").className).toContain(
      "text-status-bad",
    );
  });

  test("the screen's own status section and a relatedList's section share one drawer, in order", async () => {
    const cases: FeatureSchema = {
      featureName: "cases",
      entities: { claim: claimEntity },
      screens: [],
    };
    const detail: ProjectionDetailScreenDefinition = {
      id: "case-detail",
      type: "projectionDetail",
      query: "cases:query:case:detail",
      idParam: "id",
      pageHelp: { sections: [{ kind: "status", field: "status", entity: "claim" }] },
      layout: {
        sections: [
          { title: "Case", fields: ["status"] },
          {
            kind: "relatedList",
            title: "Verträge",
            query: "cases:query:lease:list",
            columns: ["status"],
            entity: "rentals:lease",
            pageHelp: { sections: [{ kind: "status", field: "status" }] },
          },
        ],
      },
    };
    render(
      <Locale>
        <DispatcherProvider dispatcher={detailAndRows}>
          <AppFeaturesProvider features={[rentals, cases]}>
            <KumikoScreen
              schema={{ ...cases, screens: [detail] }}
              qn="cases:screen:case-detail"
              entityId="c-1"
            />
          </AppFeaturesProvider>
        </DispatcherProvider>
      </Locale>,
    );
    expect(await screen.findAllByTestId("page-help-button")).toHaveLength(1);
    await userEvent.click(screen.getByTestId("page-help-button"));
    const drawer = screen.getByTestId("page-help-drawer");
    const own = within(drawer).getByTestId("page-help-section-0");
    expect(own.textContent).toContain("Fall");
    expect(own.textContent).toContain("Was die Status bedeuten");
    expect(own.textContent).toContain("Der Vorgang wartet.");
    const tab = within(drawer).getByTestId("page-help-section-1");
    expect(tab.textContent).toContain("Verträge");
    expect(tab.textContent).toContain("Der Vertrag läuft.");
    expect(within(drawer).queryByTestId("page-help-section-2")).toBeNull();
  });
});
