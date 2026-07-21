// Render-Test gegen echte i18n-Bundles (fängt fehlende Keys — der Screen
// darf nie rohe "userDataRights.privacyCenter.*"-Keys zeigen) plus QN-Wiring
// (die dispatchten Query-/Handler-Namen) und die status-getriebenen Branches.
// Provider-Wrapper lokal (Dependency-Richtung renderer-web → bundled-features
// verbietet test-utils-Import).

import { describe, expect, test } from "bun:test";
import { createStore, type Dispatcher, type DispatcherStatus } from "@cosmicdrift/kumiko-headless";
import {
  createStaticLocaleResolver,
  DispatcherProvider,
  kumikoDefaultTranslations,
  type LiveEventSubscriber,
  LiveEventsProvider,
  LocaleProvider,
  PrimitivesProvider,
  TokensProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives, defaultTokens } from "@cosmicdrift/kumiko-renderer-web";
import { fireEvent, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { UserQueries } from "../../../user";
import {
  EXPORT_JOB_STATUS,
  USER_ME_QUERY,
  UserDataRightsHandlers,
  UserDataRightsQueries,
} from "../../constants";
import { EXPORT_JOB_STATUS as SCHEMA_EXPORT_JOB_STATUS } from "../../schema/export-job";
import { defaultTranslations } from "../i18n";
import { formatDate, PrivacyCenterScreen } from "../privacy-center-screen";

const stubLiveEvents: LiveEventSubscriber = () => () => {};
const stubTokens = {
  tokens: defaultTokens,
  mode: "light" as const,
  setMode: () => {},
  toggleMode: () => {},
};
const stubResolver = createStaticLocaleResolver();

type QueryResponses = {
  readonly me: Record<string, unknown>;
  readonly exportStatus?: unknown;
  readonly auditLog?: unknown;
};

function makeDispatcher(
  responses: QueryResponses,
  writes: Array<{ type: string; payload: unknown }>,
  queries: Array<{ type: string; payload: unknown }> = [],
): Dispatcher {
  const statusStore = createStore<DispatcherStatus>("online");
  const query = (async (type: string, payload: unknown) => {
    queries.push({ type, payload });
    if (type === USER_ME_QUERY) return { isSuccess: true, data: responses.me };
    if (type === UserDataRightsQueries.exportStatus) {
      return { isSuccess: true, data: responses.exportStatus ?? { hasJob: false } };
    }
    if (type === UserDataRightsQueries.myAuditLog) {
      return { isSuccess: true, data: responses.auditLog ?? { rows: [] } };
    }
    return { isSuccess: true, data: null };
  }) as unknown as Dispatcher["query"];
  const write = (async (type: string, payload: unknown) => {
    writes.push({ type, payload });
    return { isSuccess: true, data: {} };
  }) as unknown as Dispatcher["write"];
  return {
    write,
    query,
    batch: (async () => ({ isSuccess: true, results: [] })) as unknown as Dispatcher["batch"],
    statusStore,
    async *stream() {},
    pendingWrites: () => [],
    pendingFiles: () => [],
  } as unknown as Dispatcher; // @cast-boundary test-stub
}

function renderCenter(
  responses: QueryResponses,
  opts: { readonly showDeletion?: boolean } = {},
): {
  view: ReturnType<typeof render>;
  writes: Array<{ type: string; payload: unknown }>;
  queries: Array<{ type: string; payload: unknown }>;
} {
  const writes: Array<{ type: string; payload: unknown }> = [];
  const queries: Array<{ type: string; payload: unknown }> = [];
  const wrapper = ({ children }: { readonly children: ReactNode }): ReactNode => (
    <TokensProvider value={stubTokens}>
      <LocaleProvider
        resolver={stubResolver}
        fallbackBundles={[defaultTranslations, kumikoDefaultTranslations]}
      >
        <PrimitivesProvider value={defaultPrimitives}>
          <LiveEventsProvider value={stubLiveEvents}>
            <DispatcherProvider dispatcher={makeDispatcher(responses, writes, queries)}>
              {children}
            </DispatcherProvider>
          </LiveEventsProvider>
        </PrimitivesProvider>
      </LocaleProvider>
    </TokensProvider>
  );
  const view = render(<PrivacyCenterScreen showDeletion={opts.showDeletion ?? true} />, {
    wrapper,
  });
  return { view, writes, queries };
}

const activeMe = {
  id: "00000000-0000-4000-8000-000000000042",
  email: "marc@example.com",
  status: "active",
  gracePeriodEnd: null,
};

async function waitForMount(view: ReturnType<typeof render>): Promise<void> {
  await waitFor(() => {
    if (view.queryByTestId("privacy-center-screen") === null) {
      throw new Error("not mounted yet");
    }
  });
}

// CI runs this file in its own `bun test` process (own ci.yml step), NOT in the
// shared `kumiko check` run — see bunfig.ci.toml pathIgnorePatterns. In the shared
// single-process happy-dom, the global `afterEach` from `test-setup/dom.preload.ts`
// plus accumulated global DOM/event state across ~30 prior DOM test files corrupts
// these in-flight renders (#457-class). A fresh process has no such accumulation.
// The QN-Drift-Pins + formatDate describes below are pure-logic and CI-stable.
describe("PrivacyCenterScreen", () => {
  test("aktiver User: Export/Einschränken/Löschen-Sektionen, Texte übersetzt (keine rohen Keys)", async () => {
    const { view } = renderCenter({ me: activeMe });
    await waitForMount(view);
    expect(view.getByTestId("privacy-export")).toBeTruthy();
    expect(view.getByTestId("privacy-restriction")).toBeTruthy();
    expect(view.getByTestId("privacy-deletion")).toBeTruthy();
    expect(view.getByTestId("privacy-export-request")).toBeTruthy();
    expect(view.getByTestId("privacy-restriction-restrict")).toBeTruthy();
    expect(view.getByTestId("privacy-deletion-delete")).toBeTruthy();
    expect(view.container.textContent).not.toContain("userDataRights.privacyCenter");
  });

  test("export done: Download-Button + Verfügbar-bis-Datum", async () => {
    const { view } = renderCenter({
      me: activeMe,
      exportStatus: {
        hasJob: true,
        job: { id: "job-123", status: EXPORT_JOB_STATUS.Done, expiresAt: "2026-07-11T00:00:00Z" },
      },
    });
    await waitForMount(view);
    expect(view.getByTestId("privacy-export-download")).toBeTruthy();
    const ready = view.getByTestId("privacy-export-ready");
    expect(ready.textContent).toContain("2026-07-11");
    expect(ready.textContent).not.toContain("T00:00");
  });

  test("export failed: Fehler-Banner + Re-Request möglich", async () => {
    const { view } = renderCenter({
      me: activeMe,
      exportStatus: { hasJob: true, job: { id: "job-9", status: EXPORT_JOB_STATUS.Failed } },
    });
    await waitForMount(view);
    expect(view.getByTestId("privacy-export-failed")).toBeTruthy();
    expect(view.getByTestId("privacy-export-request")).toBeTruthy();
  });

  test("export pending: in-progress Banner, kein Request-Button", async () => {
    const { view } = renderCenter({
      me: activeMe,
      exportStatus: { hasJob: true, job: { id: "job-1", status: EXPORT_JOB_STATUS.Pending } },
    });
    await waitForMount(view);
    expect(view.getByTestId("privacy-export-pending")).toBeTruthy();
    expect(view.queryByTestId("privacy-export-request")).toBeNull();
  });

  test("deletionRequested: Frist-Banner + Abbrechen statt Lösch-Button", async () => {
    const { view } = renderCenter({
      me: { ...activeMe, status: "deletionRequested", gracePeriodEnd: "2026-07-11T00:00:00Z" },
    });
    await waitForMount(view);
    const banner = view.getByTestId("privacy-deletion-requested");
    expect(banner.textContent).toContain("2026-07-11");
    expect(banner.textContent).not.toContain("{date}");
    expect(banner.textContent).not.toContain("T00:00");
    expect(view.queryByTestId("privacy-deletion-delete")).toBeNull();
    expect(view.getByTestId("privacy-deletion-cancel")).toBeTruthy();
  });

  test("restricted: Info-Banner statt Einschränken-Button", async () => {
    const { view } = renderCenter({ me: { ...activeMe, status: "restricted" } });
    await waitForMount(view);
    expect(view.getByTestId("privacy-restriction-active")).toBeTruthy();
    expect(view.queryByTestId("privacy-restriction-restrict")).toBeNull();
  });

  test("Export-Request dispatcht den korrekten Handler-QN", async () => {
    const { view, writes } = renderCenter({ me: activeMe });
    await waitForMount(view);
    fireEvent.click(view.getByTestId("privacy-export-request"));
    await waitFor(() => {
      if (writes.length === 0) throw new Error("no write dispatched");
    });
    expect(writes[0]?.type).toBe(UserDataRightsHandlers.requestExport);
  });

  test("showDeletion=false: keine Lösch-Sektion", async () => {
    const { view } = renderCenter({ me: activeMe }, { showDeletion: false });
    await waitForMount(view);
    expect(view.queryByTestId("privacy-deletion")).toBeNull();
    expect(view.queryByTestId("privacy-deletion-delete")).toBeNull();
  });

  test("Download-Button dispatcht downloadByJob mit der korrekten jobId", async () => {
    const { view, queries } = renderCenter({
      me: activeMe,
      exportStatus: {
        hasJob: true,
        job: { id: "job-123", status: EXPORT_JOB_STATUS.Done, expiresAt: "2026-07-11T00:00:00Z" },
      },
    });
    await waitForMount(view);
    fireEvent.click(view.getByTestId("privacy-export-download"));
    await waitFor(() => {
      if (!queries.some((q) => q.type === UserDataRightsQueries.downloadByJob)) {
        throw new Error("no downloadByJob query dispatched");
      }
    });
    const download = queries.find((q) => q.type === UserDataRightsQueries.downloadByJob);
    expect(download?.payload).toEqual({ jobId: "job-123" });
  });
});

describe("QN-Drift-Pins (client-Konstanten vs. Feature-Originale)", () => {
  test("USER_ME_QUERY spiegelt UserQueries.me", () => {
    expect(USER_ME_QUERY).toBe(UserQueries.me);
  });

  test("EXPORT_JOB_STATUS-Mirror deckt sich mit dem Schema-Original", () => {
    expect(EXPORT_JOB_STATUS).toEqual(SCHEMA_EXPORT_JOB_STATUS);
  });
});

describe("formatDate", () => {
  test("ISO instant → date part only (strips time + Z)", () => {
    expect(formatDate("2026-07-11T00:00:00.000Z")).toBe("2026-07-11");
  });

  test("null / undefined / empty → em dash", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("")).toBe("—");
  });

  test("date-only string without time → returned as-is", () => {
    expect(formatDate("2026-07-11")).toBe("2026-07-11");
  });
});

